#!/usr/bin/env node
/**
 * Reply Like Me — MCP Server
 *
 * Unified MCP server with reply generation engine (PERS-403):
 *   - Reply generation with per-contact style matching
 *   - Draft management (review, edit, send)
 *   - Contact/profile queries
 *   - Semantic message search (Pinecone)
 *   - Feedback tracking for quality improvement
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec as execCb } from "child_process";
import { promisify } from "util";

import { createSupabaseStore } from "./supabase.js";
import { createLLMRouter } from "./llm-router.js";
import { createReplyEngine } from "./reply-engine.js";
import { createEmbedder } from "./embeddings.js";
import { createPineconeClient } from "./pinecone.js";
import type { DraftReply, Message } from "./types/index.js";

const execAsync = promisify(execCb);

// ── Environment ──────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = requireEnv("SUPABASE_SERVICE_KEY");
const GOOGLE_API_KEY = requireEnv("GOOGLE_API_KEY");
const PINECONE_API_KEY = requireEnv("PINECONE_API_KEY");
const PINECONE_INDEX = requireEnv("PINECONE_INDEX");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT;

// ── Initialize Services ──────────────────────────────────────────

const store = createSupabaseStore(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const embedder = createEmbedder(GOOGLE_API_KEY);
const pinecone = createPineconeClient(PINECONE_API_KEY, PINECONE_INDEX);

const router = createLLMRouter({
  anthropicApiKey: ANTHROPIC_API_KEY,
  deepseekApiKey: DEEPSEEK_API_KEY,
  ollamaEndpoint: OLLAMA_ENDPOINT,
});

const engine = createReplyEngine({
  store,
  router,
  googleApiKey: GOOGLE_API_KEY,
  pineconeApiKey: PINECONE_API_KEY,
  pineconeIndex: PINECONE_INDEX,
});

// ── Helpers ──────────────────────────────────────────────────────

function toolText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${message}` }],
    isError: true,
  };
}

// ── MCP Server ───────────────────────────────────────────────────

const server = new McpServer(
  { name: "reply-like-me", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Reply Like Me — generates draft replies matching Julian's communication " +
      "style per contact. Query contacts, profiles, messages, and manage drafts.",
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 1 — generate_reply
// ═════════════════════════════════════════════════════════════════
server.tool(
  "generate_reply",
  "Generate a draft reply matching Julian's style for a specific contact. " +
    "Retrieves context, builds style prompt, generates via tiered LLM, applies cadence modeling.",
  {
    contact_id: z.string().describe("UUID of the contact in rlm_contacts"),
    incoming_message: z.string().describe("The message to reply to"),
  },
  async ({ contact_id, incoming_message }) => {
    try {
      const draft = await engine.generateReply(contact_id, incoming_message);
      return toolText(
        JSON.stringify(
          {
            draft_id: draft.id,
            contact: draft.contact_name ?? draft.contact_phone,
            bubbles: draft.bubbles,
            confidence: draft.confidence,
            llm: `${draft.llm_provider}/${draft.llm_model}`,
            reasoning: draft.reasoning,
            status: draft.status,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 2 — generate_reply_by_phone
// ═════════════════════════════════════════════════════════════════
server.tool(
  "generate_reply_by_phone",
  "Generate a draft reply by phone number (E.164). Looks up contact first.",
  {
    phone: z.string().describe("Phone in E.164 format, e.g. +16195090699"),
    incoming_message: z.string().describe("The message to reply to"),
  },
  async ({ phone, incoming_message }) => {
    try {
      const contact = await store.getContactByPhone(phone);
      if (!contact) return toolError(`No contact found for phone: ${phone}`);

      const draft = await engine.generateReply(contact.id, incoming_message);
      return toolText(
        JSON.stringify(
          {
            draft_id: draft.id,
            contact: draft.contact_name ?? phone,
            bubbles: draft.bubbles,
            confidence: draft.confidence,
            llm: `${draft.llm_provider}/${draft.llm_model}`,
            reasoning: draft.reasoning,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 3 — list_drafts
// ═════════════════════════════════════════════════════════════════
server.tool(
  "list_drafts",
  "List pending draft replies awaiting Julian's review.",
  {
    limit: z.number().optional().default(20).describe("Max drafts to return"),
  },
  async ({ limit }) => {
    try {
      const drafts = await store.getPendingDrafts(limit);
      return toolText(
        JSON.stringify(
          drafts.map((d: DraftReply) => ({
            id: d.id,
            contact: d.contact_name ?? d.contact_phone,
            incoming: d.incoming_message.slice(0, 80),
            reply: d.bubbles.join(" | "),
            confidence: d.confidence,
            created: d.created_at,
          })),
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 4 — review_draft
// ═════════════════════════════════════════════════════════════════
server.tool(
  "review_draft",
  "Review a draft: accept, edit, or reject. Tracks feedback for quality improvement.",
  {
    draft_id: z.string().describe("UUID of the draft reply"),
    action: z.enum(["accept", "edit", "reject"]).describe("Review action"),
    edited_bubbles: z
      .array(z.string())
      .optional()
      .describe("Edited bubbles (required if action is 'edit')"),
  },
  async ({ draft_id, action, edited_bubbles }) => {
    try {
      if (action === "edit" && (!edited_bubbles || edited_bubbles.length === 0)) {
        return toolError("edited_bubbles required when action is 'edit'");
      }

      const statusMap = {
        accept: "accepted",
        edit: "edited",
        reject: "rejected",
      } as const;

      const draft = await store.updateDraftStatus(
        draft_id,
        statusMap[action],
        action === "edit" ? edited_bubbles : undefined,
      );

      return toolText(
        JSON.stringify(
          {
            id: draft.id,
            status: draft.status,
            contact: draft.contact_name ?? draft.contact_phone,
            bubbles: draft.edited_bubbles ?? draft.bubbles,
            reviewed_at: draft.reviewed_at,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 5 — send_draft
// ═════════════════════════════════════════════════════════════════
server.tool(
  "send_draft",
  "Send an accepted/edited draft via iMessage using god CLI. Marks as 'sent'.",
  {
    draft_id: z.string().describe("UUID of the draft to send"),
  },
  async ({ draft_id }) => {
    try {
      const draft = await store.getDraft(draft_id);
      if (!draft) return toolError(`Draft not found: ${draft_id}`);

      if (draft.status !== "accepted" && draft.status !== "edited") {
        return toolError(
          `Draft must be accepted/edited first. Current: ${draft.status}`,
        );
      }
      if (!draft.contact_phone) {
        return toolError("Contact has no phone number");
      }

      const bubbles = draft.edited_bubbles ?? draft.bubbles;
      const results: string[] = [];

      for (const bubble of bubbles) {
        try {
          const escaped = bubble.replace(/"/g, '\\"');
          await execAsync(
            `god mac send "${draft.contact_phone}" "${escaped}"`,
          );
          results.push(`✓ "${bubble.slice(0, 50)}${bubble.length > 50 ? "..." : ""}"`);
        } catch (sendErr) {
          results.push(
            `✗ "${bubble.slice(0, 50)}..." — ${(sendErr as Error).message}`,
          );
        }
      }

      await store.updateDraftStatus(draft_id, "sent");

      return toolText(
        JSON.stringify(
          {
            sent_to: draft.contact_phone,
            contact: draft.contact_name,
            bubbles_sent: bubbles.length,
            results,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 6 — contact_lookup
// ═════════════════════════════════════════════════════════════════
server.tool(
  "contact_lookup",
  "Look up a contact by phone or handle. Returns contact info and style profile.",
  {
    query: z.string().describe("Phone number or handle_id"),
  },
  async ({ query }) => {
    try {
      const normalized = query.replace(/[\s\-()]/g, "");
      const isPhone = /^\+?\d{7,15}$/.test(normalized);

      let contact;
      if (isPhone) {
        contact = await store.getContactByPhone(normalized);
        if (!contact) contact = await store.getContactByHandle(normalized);
      } else {
        contact = await store.getContactByHandle(query);
      }

      if (!contact) return toolText(`No contact found for "${query}"`);

      const profile = await store.getProfile(contact.id);

      return toolText(
        JSON.stringify(
          {
            contact: {
              id: contact.id,
              name: contact.display_name,
              phone: contact.phone,
              email: contact.email,
              relationship: contact.relationship_type,
              circle: contact.circle_rank,
              messages: contact.message_count,
              last_message: contact.last_message_at,
            },
            profile: profile
              ? {
                  formality: `${profile.formality}/10`,
                  avg_length: profile.avg_message_length,
                  emoji_freq: `${(profile.emoji_frequency * 100).toFixed(0)}%`,
                  common_emojis: profile.common_emojis,
                  greetings: profile.greeting_patterns,
                  signoffs: profile.signoff_patterns,
                  slang: profile.slang_terms,
                  bubbles_per_reply: profile.avg_bubbles_per_reply,
                  chars_per_bubble: profile.avg_chars_per_bubble,
                  response_delay_min: profile.avg_response_delay_minutes,
                  samples: profile.sample_messages.slice(0, 5),
                }
              : null,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 7 — search_messages
// ═════════════════════════════════════════════════════════════════
server.tool(
  "search_messages",
  "Semantic search across Julian's iMessage history using Pinecone embeddings.",
  {
    query: z.string().describe("Search query text"),
    contact_id: z.string().optional().describe("Filter to specific contact"),
    top_k: z.number().optional().default(10).describe("Number of results"),
  },
  async ({ query, contact_id, top_k }) => {
    try {
      const vector = await embedder.embedSingle(query);
      const filter: Record<string, unknown> = {};
      if (contact_id) filter.contact_id = contact_id;

      const results = await pinecone.queryByVector(
        vector,
        top_k,
        Object.keys(filter).length > 0 ? filter : undefined,
      );

      const matches = (results.matches ?? []).map((m) => ({
        text: m.metadata?.text ?? "",
        contact: m.metadata?.contact_name ?? "unknown",
        from: m.metadata?.is_from_me ? "Julian" : "them",
        score: m.score,
        timestamp: m.metadata?.timestamp ?? "",
      }));

      return toolText(JSON.stringify(matches, null, 2));
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 8 — draft_stats
// ═════════════════════════════════════════════════════════════════
server.tool(
  "draft_stats",
  "Get draft statistics — total, acceptance rate, breakdown by status.",
  {},
  async () => {
    try {
      const stats = await store.getDraftStats();
      return toolText(
        JSON.stringify(
          {
            ...stats,
            acceptanceRate: `${(stats.acceptanceRate * 100).toFixed(1)}%`,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ═════════════════════════════════════════════════════════════════
// TOOL 9 — get_conversation_context
// ═════════════════════════════════════════════════════════════════
server.tool(
  "get_conversation_context",
  "Get recent conversation history and style profile for a contact.",
  {
    contact_id: z.string().describe("Contact UUID"),
    limit: z.number().min(1).max(100).default(20).describe("Number of recent messages"),
  },
  async ({ contact_id, limit }) => {
    try {
      const [contact, profile, messages] = await Promise.all([
        store.getContact(contact_id),
        store.getProfile(contact_id),
        store.getRecentMessages(contact_id, limit),
      ]);

      if (!contact) return toolError(`Contact not found: ${contact_id}`);

      return toolText(
        JSON.stringify(
          {
            contact: {
              name: contact.display_name,
              phone: contact.phone,
              circle: contact.circle_rank,
              relationship: contact.relationship_type,
            },
            profile: profile
              ? {
                  formality: profile.formality,
                  emoji_freq: profile.emoji_frequency,
                  avg_length: profile.avg_message_length,
                  bubbles: profile.avg_bubbles_per_reply,
                }
              : null,
            messages: messages.map((m: Message) => ({
              from: m.is_from_me ? "Julian" : (contact.display_name ?? "them"),
              text: m.text,
              timestamp: m.timestamp,
            })),
            total: messages.length,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      return toolError((err as Error).message);
    }
  },
);

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[reply-like-me] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[reply-like-me] Fatal:", err);
  process.exit(1);
});
