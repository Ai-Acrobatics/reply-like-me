#!/usr/bin/env node
/**
 * Reply Like Me — Unified MCP Server
 *
 * Single MCP tool that queries across four data stores:
 *   - Supabase (structured data: messages, contacts, profiles, cadence)
 *   - Pinecone (semantic search: message embeddings, image vectors)
 *   - Obsidian (human-readable relationship summaries)
 *   - Notion (read-only meeting context — deferred to v2)
 *
 * Registered as a Claude Code MCP server so any fleet agent can query
 * Julian's communication data for reply generation, contact lookup, etc.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSupabaseClient } from "./clients/supabase.js";
import { createPineconeClient } from "./clients/pinecone.js";
import { readObsidianProfile } from "./clients/obsidian.js";
import { createEmbedder } from "./embeddings.js";

// ── Bootstrap ──────────────────────────────────────────────────────────
const supabase = createSupabaseClient();
const pinecone = createPineconeClient();
const embedder = createEmbedder(process.env.GOOGLE_API_KEY!);

const server = new McpServer(
  { name: "reply-like-me", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Unified data layer for Reply Like Me. " +
      "Query Julian's iMessage history, contact profiles, style data, " +
      "and semantic search across 1.24M messages.",
  },
);

// ── Helpers ────────────────────────────────────────────────────────────

function toolText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: `ERROR: ${message}` }], isError: true };
}

// ═══════════════════════════════════════════════════════════════════════
// TOOL 1 — contact_lookup
// Find a contact by phone, email, or name. Returns profile + style data.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "contact_lookup",
  "Look up a contact by phone number, email, or name. Returns contact info, style profile, cadence stats, and Obsidian relationship summary.",
  {
    query: z.string().describe("Phone number, email, or name to search for"),
    include_obsidian: z
      .boolean()
      .default(true)
      .describe("Include Obsidian relationship summary if available"),
  },
  async ({ query, include_obsidian }) => {
    const normalized = query.replace(/[\s\-\(\)]/g, "");
    const isPhone = /^\+?\d{7,15}$/.test(normalized);

    let contactQuery = supabase.from("rlm_contacts").select("*");
    if (isPhone) {
      contactQuery = contactQuery.or(
        `phone.eq.${normalized},handle_id.eq.${normalized}`,
      );
    } else if (query.includes("@")) {
      contactQuery = contactQuery.eq("email", query.toLowerCase());
    } else {
      contactQuery = contactQuery.ilike("display_name", `%${query}%`);
    }

    const { data: contacts, error: contactErr } = await contactQuery.limit(5);
    if (contactErr) return toolError(`Supabase error: ${contactErr.message}`);
    if (!contacts?.length) return toolText(`No contact found for "${query}"`);

    const contact = contacts[0];

    const { data: profile } = await supabase
      .from("rlm_style_profiles")
      .select("*")
      .eq("contact_id", contact.id)
      .single();

    const { data: cadence } = await supabase
      .from("rlm_cadence_patterns")
      .select("*")
      .eq("contact_id", contact.id);

    let obsidianSummary: string | null = null;
    if (include_obsidian && contact.display_name) {
      obsidianSummary = await readObsidianProfile(contact.display_name);
    }

    return toolText(
      JSON.stringify(
        {
          contact,
          style_profile: profile || null,
          cadence_patterns: cadence || [],
          obsidian_summary: obsidianSummary,
        },
        null,
        2,
      ),
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 2 — search_messages
// Semantic or keyword search across Julian's message history.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "search_messages",
  "Search Julian's iMessage history. Supports semantic (vector) search or keyword filter. Can scope to a specific contact.",
  {
    query: z.string().describe("Search query (semantic or keyword)"),
    contact_id: z
      .string()
      .optional()
      .describe("Filter to a specific contact UUID"),
    mode: z
      .enum(["semantic", "keyword"])
      .default("semantic")
      .describe("Search mode"),
    limit: z.number().min(1).max(50).default(10).describe("Max results"),
    from_julian_only: z
      .boolean()
      .default(false)
      .describe("Only return messages sent by Julian"),
  },
  async ({ query, contact_id, mode, limit, from_julian_only }) => {
    if (mode === "semantic") {
      const queryEmbedding = await embedder.embedSingle(query);
      const filter: Record<string, unknown> = {};
      if (contact_id) filter.contact_id = contact_id;
      if (from_julian_only) filter.is_from_julian = true;

      const index = pinecone.index(process.env.PINECONE_INDEX!);
      const results = await index.namespace("messages").query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      const supabaseIds = results.matches
        .map((m) => m.metadata?.supabase_id as string)
        .filter(Boolean);

      let messages: Record<string, unknown>[] = [];
      if (supabaseIds.length > 0) {
        const { data } = await supabase
          .from("rlm_messages")
          .select("*")
          .in("id", supabaseIds);
        messages = data || [];
      }

      return toolText(
        JSON.stringify(
          {
            mode: "semantic",
            total: results.matches.length,
            messages: messages.map((m) => ({
              ...m,
              score: results.matches.find(
                (r) => r.metadata?.supabase_id === (m as { id: string }).id,
              )?.score,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      let q = supabase
        .from("rlm_messages")
        .select("*")
        .ilike("text_content", `%${query}%`)
        .order("date_utc", { ascending: false })
        .limit(limit);

      if (contact_id) q = q.eq("contact_id", contact_id);
      if (from_julian_only) q = q.eq("is_from_julian", true);

      const { data, error } = await q;
      if (error) return toolError(`Supabase error: ${error.message}`);

      return toolText(
        JSON.stringify(
          { mode: "keyword", total: data?.length || 0, messages: data || [] },
          null,
          2,
        ),
      );
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 3 — get_conversation_context
// Fetch the last N messages for a contact (for reply generation RAG).
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "get_conversation_context",
  "Get recent conversation history with a specific contact. Essential context for generating replies.",
  {
    contact_id: z.string().describe("Contact UUID"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of recent messages"),
    include_profile: z
      .boolean()
      .default(true)
      .describe("Include style profile in response"),
  },
  async ({ contact_id, limit, include_profile }) => {
    const { data: messages, error } = await supabase
      .from("rlm_messages")
      .select("*")
      .eq("contact_id", contact_id)
      .order("date_utc", { ascending: false })
      .limit(limit);

    if (error) return toolError(`Supabase error: ${error.message}`);

    let profile = null;
    if (include_profile) {
      const { data } = await supabase
        .from("rlm_style_profiles")
        .select("*")
        .eq("contact_id", contact_id)
        .single();
      profile = data;
    }

    const { data: contact } = await supabase
      .from("rlm_contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    return toolText(
      JSON.stringify(
        {
          contact: contact || null,
          style_profile: profile,
          messages: (messages || []).reverse(),
          message_count: messages?.length || 0,
        },
        null,
        2,
      ),
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 4 — get_style_profile
// Return the full style profile for generating Julian-like replies.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "get_style_profile",
  "Get Julian's communication style profile for a contact. Includes formality, emoji usage, message length, burst patterns, greeting/signoff patterns, and cadence timing.",
  {
    contact_id: z.string().describe("Contact UUID"),
    include_cadence: z
      .boolean()
      .default(true)
      .describe("Include timing/cadence model"),
    include_obsidian: z
      .boolean()
      .default(true)
      .describe("Include Obsidian relationship notes"),
  },
  async ({ contact_id, include_cadence, include_obsidian }) => {
    const { data: profile, error } = await supabase
      .from("rlm_style_profiles")
      .select("*")
      .eq("contact_id", contact_id)
      .single();

    if (error) return toolError(`Profile not found: ${error.message}`);

    let cadence = null;
    if (include_cadence) {
      const { data } = await supabase
        .from("rlm_cadence_patterns")
        .select("*")
        .eq("contact_id", contact_id);
      cadence = data;
    }

    let obsidian = null;
    if (include_obsidian) {
      const { data: contact } = await supabase
        .from("rlm_contacts")
        .select("display_name")
        .eq("id", contact_id)
        .single();
      if (contact?.display_name) {
        obsidian = await readObsidianProfile(contact.display_name);
      }
    }

    return toolText(
      JSON.stringify(
        { style_profile: profile, cadence_patterns: cadence, obsidian_summary: obsidian },
        null,
        2,
      ),
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 5 — search_images
// Semantic image search across Julian's iMessage attachments.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "search_images",
  "Search Julian's iMessage image attachments using semantic similarity. Query with text to find matching photos.",
  {
    query: z
      .string()
      .describe("Text description of the image to find (e.g., 'photo at the beach')"),
    contact_id: z
      .string()
      .optional()
      .describe("Filter to a specific contact UUID"),
    meaningful_only: z
      .boolean()
      .default(true)
      .describe("Exclude memes, GIFs, and stickers"),
    limit: z.number().min(1).max(20).default(5).describe("Max results"),
  },
  async ({ query, contact_id, meaningful_only, limit }) => {
    const queryEmbedding = await embedder.embedSingle(query);
    const filter: Record<string, unknown> = {};
    if (contact_id) filter.contact_id = contact_id;
    if (meaningful_only) filter.is_meaningful = true;

    const index = pinecone.index(process.env.PINECONE_INDEX!);
    const results = await index.namespace("images").query({
      vector: queryEmbedding,
      topK: limit,
      includeMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    const attachmentIds = results.matches
      .map((m) => m.metadata?.supabase_id as string)
      .filter(Boolean);

    let attachments: Record<string, unknown>[] = [];
    if (attachmentIds.length > 0) {
      const { data } = await supabase
        .from("rlm_attachments")
        .select("*")
        .in("id", attachmentIds);
      attachments = data || [];
    }

    return toolText(
      JSON.stringify(
        {
          total: results.matches.length,
          images: results.matches.map((m) => ({
            score: m.score,
            metadata: m.metadata,
            attachment: attachments.find(
              (a) => (a as { id: string }).id === m.metadata?.supabase_id,
            ),
          })),
        },
        null,
        2,
      ),
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 6 — log_response
// Log a generated/sent response for the feedback loop.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "log_response",
  "Log a generated reply for the feedback loop. Tracks which responses Julian accepted, edited, or rejected.",
  {
    contact_id: z.string().describe("Contact UUID"),
    incoming_message: z.string().describe("The message Julian received"),
    generated_response: z.string().describe("The AI-generated reply"),
    model_used: z.string().describe("Model that generated the reply"),
    was_sent: z.boolean().default(false).describe("Whether the response was actually sent"),
    was_edited: z.boolean().default(false).describe("Whether Julian edited the response"),
    edited_response: z
      .string()
      .optional()
      .describe("Julian's edited version (for learning)"),
    confidence_score: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Model confidence 0-1"),
  },
  async (params) => {
    const { data, error } = await supabase
      .from("rlm_response_log")
      .insert({
        contact_id: params.contact_id,
        incoming_message: params.incoming_message,
        generated_response: params.generated_response,
        model_used: params.model_used,
        was_sent: params.was_sent,
        was_edited: params.was_edited,
        edited_response: params.edited_response || null,
        confidence_score: params.confidence_score || null,
      })
      .select()
      .single();

    if (error) return toolError(`Failed to log response: ${error.message}`);
    return toolText(JSON.stringify({ logged: true, id: data.id }, null, 2));
  },
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL 7 — list_contacts
// Browse contacts with filters for relationship type, activity, etc.
// ═══════════════════════════════════════════════════════════════════════
server.tool(
  "list_contacts",
  "List contacts with optional filters. Useful for finding who Julian talks to most, dormant contacts, etc.",
  {
    relationship_type: z
      .enum(["family", "friend", "client", "vendor", "acquaintance", "all"])
      .default("all")
      .describe("Filter by relationship type"),
    active_only: z
      .boolean()
      .default(true)
      .describe("Only contacts with messages in the last 90 days"),
    sort_by: z
      .enum(["total_messages", "last_message_at", "display_name"])
      .default("total_messages")
      .describe("Sort order"),
    limit: z.number().min(1).max(100).default(25).describe("Max results"),
  },
  async ({ relationship_type, active_only, sort_by, limit }) => {
    let q = supabase
      .from("rlm_contacts")
      .select("*")
      .order(sort_by, { ascending: sort_by === "display_name" })
      .limit(limit);

    if (relationship_type !== "all") {
      q = q.eq("relationship_type", relationship_type);
    }
    if (active_only) {
      q = q.eq("is_active", true);
    }

    const { data, error } = await q;
    if (error) return toolError(`Supabase error: ${error.message}`);
    return toolText(
      JSON.stringify({ total: data?.length || 0, contacts: data || [] }, null, 2),
    );
  },
);

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("reply-like-me MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
