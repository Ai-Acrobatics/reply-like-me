/**
 * Reply Generation Engine — Reply Like Me (PERS-403)
 *
 * Core engine that:
 * 1. Retrieves context (recent messages + contact profile + similar messages from Pinecone)
 * 2. Builds a style-matched system prompt from the contact's communication profile
 * 3. Generates a reply via tiered LLM routing
 * 4. Applies cadence modeling (splits into correct number of message bubbles)
 * 5. Stores draft for Julian's review
 */

import type { SupabaseStore } from "./supabase.js";
import type { LLMRouter } from "./llm-router.js";
import type {
  Contact,
  CommunicationProfile,
  DraftReply,
  Message,
  ReplyContext,
  SimilarMessage,
} from "./types/index.js";
import { createEmbedder } from "./embeddings.js";
import { createPineconeClient } from "./pinecone.js";

// ── Config ───────────────────────────────────────────────────────

/** `direction` value used for messages Julian sent (see generate-embeddings.ts). */
const OUTBOUND_DIRECTION = "outbound";

export interface ReplyEngineConfig {
  store: SupabaseStore;
  router: LLMRouter;
  googleApiKey: string;
  pineconeApiKey: string;
  pineconeIndex: string;
  recentMessageLimit?: number;
  similarMessageLimit?: number;
}

export function createReplyEngine(config: ReplyEngineConfig) {
  const {
    store,
    router,
    googleApiKey,
    pineconeApiKey,
    pineconeIndex,
    recentMessageLimit = 20,
    similarMessageLimit = 5,
  } = config;

  const embedder = createEmbedder(googleApiKey);
  const pinecone = createPineconeClient(pineconeApiKey, pineconeIndex);

  // ── Context Retrieval (REPLY-01) ─────────────────────────────

  async function buildContext(
    contactId: string,
    incomingMessage: string,
  ): Promise<ReplyContext> {
    const [contact, profile, recentMessages] = await Promise.all([
      store.getContact(contactId),
      store.getProfile(contactId),
      store.getRecentMessages(contactId, recentMessageLimit),
    ]);

    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    const similarMessages = await findSimilarMessages(incomingMessage, contact);

    return {
      contact,
      profile,
      recentMessages,
      similarMessages,
      incomingMessage,
    };
  }

  /**
   * Vectors are upserted by scripts/generate-embeddings.ts with the metadata keys
   * `{ source, source_id, phone, direction, text, timestamp }` — NOT `contact_id` /
   * `is_from_me`. Filtering on the latter matched zero vectors and the empty result
   * was swallowed by the catch below, so style retrieval silently never ran.
   * Filter on `phone` + outbound `direction` instead.
   */
  async function findSimilarMessages(
    text: string,
    contact: Contact,
  ): Promise<SimilarMessage[]> {
    if (!contact.phone) return [];

    try {
      const vector = await embedder.embedSingle(text);
      const results = await pinecone.queryByVector(vector, similarMessageLimit, {
        phone: contact.phone,
        direction: OUTBOUND_DIRECTION, // Only Julian's messages for style reference
      });

      return (results.matches ?? []).map((match) => ({
        text: (match.metadata?.text as string) ?? "",
        score: match.score ?? 0,
        is_from_me: (match.metadata?.direction as string) === OUTBOUND_DIRECTION,
        contact_name: contact.display_name,
        timestamp: (match.metadata?.timestamp as string) ?? "",
      }));
    } catch (err) {
      // Non-fatal — reply generation works without similar messages
      console.error("[reply-engine] Similar message search failed:", err);
      return [];
    }
  }

  // ── System Prompt Builder ────────────────────────────────────

  function buildSystemPrompt(
    contact: Contact,
    profile: CommunicationProfile | null,
  ): string {
    const name = contact.display_name ?? contact.handle_id;

    let prompt = `You are Julian Bradley. You are writing a text message reply to ${name}.
Your goal: write a reply that sounds EXACTLY like Julian would write it — same tone, length, emoji usage, and vibe.

CRITICAL RULES:
- You are Julian. Write in first person.
- Match the exact communication style Julian uses with THIS specific person.
- Do NOT sound like an AI. No overly formal language. No "I hope this message finds you well" type phrases.
- Keep it natural and conversational.
- Output ONLY the reply text. No explanations, no "Here's a draft", no meta-commentary.
`;

    if (profile) {
      prompt += `
JULIAN'S STYLE WITH ${name.toUpperCase()}:
- Formality level: ${profile.formality}/10 (1=super casual, 10=very formal)
- Average message length: ~${profile.avg_message_length} characters
- Emoji usage: ${describeEmojiFreq(profile.emoji_frequency)}${profile.common_emojis.length > 0 ? ` (commonly uses: ${profile.common_emojis.join(" ")})` : ""}
- Greeting patterns: ${profile.greeting_patterns.length > 0 ? profile.greeting_patterns.join(", ") : "none specific"}
- Sign-off patterns: ${profile.signoff_patterns.length > 0 ? profile.signoff_patterns.join(", ") : "none specific"}
${profile.slang_terms.length > 0 ? `- Slang/phrases Julian uses: ${profile.slang_terms.join(", ")}` : ""}
- Typical response: ${profile.avg_bubbles_per_reply.toFixed(1)} message bubble(s), ~${Math.round(profile.avg_chars_per_bubble)} chars each
- Sentiment baseline: ${describeSentiment(profile.sentiment_baseline)}
`;

      if (profile.sample_messages.length > 0) {
        prompt += `
EXAMPLE MESSAGES JULIAN HAS SENT TO ${name.toUpperCase()}:
${profile.sample_messages.slice(0, 5).map((m) => `- "${m}"`).join("\n")}
`;
      }
    } else {
      prompt += `
No specific style profile available for ${name}. Use Julian's general texting style:
- Casual and direct
- Short messages (1-2 sentences)
- Occasional emojis
- Warm but efficient
`;
    }

    prompt += `
OUTPUT FORMAT:
- If the reply should be multiple message bubbles, separate each bubble with |||
- Example: "Hey what's up|||Yeah I saw that too|||Let me check and get back to you"
- Match the natural bubble count Julian would use with this person.
`;

    return prompt;
  }

  function describeEmojiFreq(freq: number): string {
    if (freq > 0.5) return "frequent";
    if (freq > 0.2) return "moderate";
    if (freq > 0.05) return "occasional";
    return "rare";
  }

  function describeSentiment(baseline: number): string {
    if (baseline > 0.3) return "warm/positive";
    if (baseline > -0.3) return "neutral";
    return "reserved";
  }

  // ── User Prompt Builder ──────────────────────────────────────

  function buildUserPrompt(context: ReplyContext): string {
    const { recentMessages, similarMessages, incomingMessage } = context;
    const name = context.contact.display_name ?? context.contact.handle_id;

    let prompt = "";

    // Recent conversation for context
    if (recentMessages.length > 0) {
      prompt += "RECENT CONVERSATION:\n";
      for (const msg of recentMessages.slice(-10)) {
        const sender = msg.is_from_me ? "Julian" : name;
        prompt += `[${sender}]: ${msg.text}\n`;
      }
      prompt += "\n";
    }

    // Similar past messages for style reference
    if (similarMessages.length > 0) {
      prompt += "SIMILAR PAST MESSAGES FROM JULIAN (for style reference):\n";
      for (const msg of similarMessages) {
        prompt += `- "${msg.text}" (similarity: ${(msg.score * 100).toFixed(0)}%)\n`;
      }
      prompt += "\n";
    }

    prompt += `NEW MESSAGE FROM ${name.toUpperCase()}:\n"${incomingMessage}"\n\nWrite Julian's reply:`;
    return prompt;
  }

  // ── Cadence Modeling (REPLY-03) ──────────────────────────────

  function applyCadenceModel(
    rawText: string,
    profile: CommunicationProfile | null,
  ): string[] {
    // Split on the ||| delimiter the LLM was instructed to use
    let bubbles = rawText
      .split("|||")
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (bubbles.length === 0) {
      bubbles = [rawText.trim()];
    }

    // Adjust bubble count to match contact's typical pattern
    if (profile && profile.avg_bubbles_per_reply > 0) {
      const targetBubbles = Math.round(profile.avg_bubbles_per_reply);

      // Too many bubbles — merge shortest adjacent pairs
      while (bubbles.length > targetBubbles + 1 && bubbles.length > 1) {
        let minLen = Infinity;
        let mergeIdx = 0;
        for (let i = 0; i < bubbles.length - 1; i++) {
          const combined = bubbles[i].length + bubbles[i + 1].length;
          if (combined < minLen) {
            minLen = combined;
            mergeIdx = i;
          }
        }
        bubbles[mergeIdx] = `${bubbles[mergeIdx]} ${bubbles[mergeIdx + 1]}`;
        bubbles.splice(mergeIdx + 1, 1);
      }
    }

    // Clean up LLM artifacts
    bubbles = bubbles.map((b) =>
      b
        .replace(/^["']|["']$/g, "")
        .replace(/^(Julian|Reply|Draft|Message):\s*/i, "")
        .trim(),
    );

    return bubbles.filter((b) => b.length > 0);
  }

  // ── Confidence Scoring ───────────────────────────────────────

  function scoreConfidence(context: ReplyContext, bubbles: string[]): number {
    let score = 0.5;

    if (context.profile) {
      score += 0.15;
      if (context.profile.sample_messages.length >= 3) score += 0.1;
    }

    if (context.recentMessages.length >= 5) score += 0.1;
    if (context.similarMessages.length >= 2) score += 0.1;

    // Penalize if length is way off
    const totalChars = bubbles.join(" ").length;
    if (context.profile) {
      const expectedChars =
        context.profile.avg_chars_per_bubble * context.profile.avg_bubbles_per_reply;
      if (expectedChars > 0) {
        const ratio = totalChars / expectedChars;
        if (ratio > 3 || ratio < 0.2) score -= 0.15;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  // ── Main Generation Pipeline (REPLY-01 → REPLY-04) ──────────

  async function generateReply(
    contactId: string,
    incomingMessage: string,
  ): Promise<DraftReply> {
    // Step 1: Build context
    const context = await buildContext(contactId, incomingMessage);

    // Step 2: Build prompts
    const systemPrompt = buildSystemPrompt(context.contact, context.profile);
    const userPrompt = buildUserPrompt(context);

    // Step 3: Select model and generate
    const llmConfig = router.selectModel(context.contact.circle_rank);
    const llmResponse = await router.generate(llmConfig, systemPrompt, userPrompt);

    // Step 4: Apply cadence modeling
    const bubbles = applyCadenceModel(llmResponse.text, context.profile);

    // Step 5: Score confidence
    const confidence = scoreConfidence(context, bubbles);

    // Step 6: Build reasoning summary
    const tier = router.getTierForCircle(context.contact.circle_rank);
    const reasoning = [
      `Contact: ${context.contact.display_name ?? context.contact.handle_id}`,
      `Circle: ${context.contact.circle_rank} → tier: ${tier}`,
      `Model: ${llmResponse.provider}/${llmResponse.model}`,
      `Profile: ${context.profile ? "yes" : "no"}`,
      `Recent msgs: ${context.recentMessages.length}`,
      `Similar msgs: ${context.similarMessages.length}`,
      `Tokens: ${llmResponse.tokensUsed}`,
    ].join(" | ");

    // Step 7: Save draft
    const draft = await store.saveDraft({
      contact_id: contactId,
      contact_name: context.contact.display_name,
      contact_phone: context.contact.phone,
      incoming_message: incomingMessage,
      bubbles,
      llm_provider: llmResponse.provider,
      llm_model: llmResponse.model,
      confidence,
      reasoning,
      status: "pending",
      edited_bubbles: null,
    });

    return draft;
  }

  // ── Batch Generation ─────────────────────────────────────────

  async function generateRepliesForNewMessages(
    messages: Array<{ contactId: string; text: string }>,
  ): Promise<DraftReply[]> {
    const results: DraftReply[] = [];

    for (const msg of messages) {
      try {
        const draft = await generateReply(msg.contactId, msg.text);
        results.push(draft);
      } catch (err) {
        console.error(
          `[reply-engine] Failed for contact ${msg.contactId}:`,
          err,
        );
      }
    }

    return results;
  }

  return {
    generateReply,
    generateRepliesForNewMessages,
    buildContext,
    buildSystemPrompt,
    buildUserPrompt,
    applyCadenceModel,
    scoreConfidence,
  };
}

export type ReplyEngine = ReturnType<typeof createReplyEngine>;
