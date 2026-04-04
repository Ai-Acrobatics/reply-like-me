/**
 * Ollama Client — Reply Like Me
 *
 * Calls Ollama (local LLM on VPS) for style summary generation.
 * Free inference — llama-3.3-70b running at 100.82.80.45:11434.
 *
 * Used to generate human-readable style descriptions from NLP stats.
 * Falls back gracefully if Ollama is unavailable.
 */

const DEFAULT_OLLAMA_URL = "http://100.82.80.45:11434";
const DEFAULT_MODEL = "llama3.3:70b";
const TIMEOUT_MS = 60_000; // 60s for large model

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface StyleSummaryInput {
  contact_name: string;
  relationship_type: string | null;
  formality_score: number;
  avg_message_length: number;
  emoji_frequency: number;
  top_emojis: string[];
  abbreviation_frequency: number;
  common_abbreviations: Record<string, number>;
  greeting_patterns: string[];
  signoff_patterns: string[];
  humor_frequency: number;
  sentiment_baseline: number;
  messages_per_burst: number;
  avg_response_time_seconds: number | null;
  sample_messages: string[];
}

/**
 * Generate a natural-language style summary using Ollama.
 * Returns null if Ollama is unavailable.
 */
export async function generateStyleSummary(
  input: StyleSummaryInput,
  config: OllamaConfig = {}
): Promise<string | null> {
  const baseUrl = config.baseUrl ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const model = config.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeout = config.timeoutMs ?? TIMEOUT_MS;

  const prompt = buildPrompt(input);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 500,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Ollama error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as { response: string };
    return data.response?.trim() || null;
  } catch (err) {
    // Graceful fallback — Ollama unavailable is not fatal
    console.error(`Ollama unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Generate a topic distribution analysis using Ollama.
 * Analyzes sample messages to identify main conversation topics.
 */
export async function analyzeTopics(
  contactName: string,
  sampleMessages: string[],
  config: OllamaConfig = {}
): Promise<Record<string, number> | null> {
  const baseUrl = config.baseUrl ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const model = config.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeout = config.timeoutMs ?? TIMEOUT_MS;

  if (sampleMessages.length < 5) return null;

  const msgBlock = sampleMessages.slice(0, 50).map((m, i) => `${i + 1}. ${m}`).join("\n");

  const prompt = `Analyze these messages from Julian to ${contactName} and identify the main topics of conversation. Return ONLY a JSON object mapping topic names to their approximate proportion (0.0 to 1.0, must sum to 1.0). Use 3-7 topic categories. Be specific (e.g., "fitness" not "personal", "business updates" not "work").

Messages:
${msgBlock}

Return ONLY valid JSON, no explanation:`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 300,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as { response: string };
    const text = data.response?.trim() || "";

    // Extract JSON from response (may be wrapped in code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) return null;

    // Validate: all values should be numbers 0-1
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value >= 0 && value <= 1) {
        result[key] = Math.round(value * 1000) / 1000;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

// ─── Prompt Builder ────────────────────────────────────────────────

function buildPrompt(input: StyleSummaryInput): string {
  const emojiDesc =
    input.emoji_frequency > 0.5
      ? "heavy emoji user"
      : input.emoji_frequency > 0.1
        ? "moderate emoji user"
        : input.emoji_frequency > 0
          ? "occasional emoji user"
          : "no emoji usage";

  const formality =
    input.formality_score >= 7
      ? "formal"
      : input.formality_score >= 4
        ? "semi-casual"
        : "very casual";

  const responseTime = input.avg_response_time_seconds
    ? input.avg_response_time_seconds < 300
      ? "responds quickly (under 5 min)"
      : input.avg_response_time_seconds < 3600
        ? `responds in about ${Math.round(input.avg_response_time_seconds / 60)} minutes`
        : `responds in about ${Math.round(input.avg_response_time_seconds / 3600)} hours`
    : "response time unknown";

  const samples = input.sample_messages.slice(0, 10).map((m) => `  - "${m}"`).join("\n");

  return `You are analyzing Julian Bradley's texting style with a specific contact. Write a 3-4 sentence style guide that another AI could use to mimic Julian's texting style with this person. Be specific and practical.

Contact: ${input.contact_name}
Relationship: ${input.relationship_type ?? "unknown"}

Stats:
- Formality: ${input.formality_score}/10 (${formality})
- Average message length: ${Math.round(input.avg_message_length)} chars
- Emoji: ${emojiDesc}${input.top_emojis.length > 0 ? ` (favorites: ${input.top_emojis.join(" ")})` : ""}
- Abbreviation frequency: ${Math.round(input.abbreviation_frequency * 100)}% of messages
- Common abbreviations: ${Object.keys(input.common_abbreviations).slice(0, 8).join(", ") || "none"}
- Greetings: ${input.greeting_patterns.join(", ") || "usually no greeting"}
- Sign-offs: ${input.signoff_patterns.join(", ") || "usually no sign-off"}
- Humor: ${Math.round(input.humor_frequency * 100)}% of messages contain humor markers
- Sentiment: ${input.sentiment_baseline > 0.2 ? "positive" : input.sentiment_baseline < -0.2 ? "negative" : "neutral"}
- Messages per response: ${input.messages_per_burst} (${input.messages_per_burst > 1.5 ? "often sends multiple messages" : "usually sends one message"})
- Response time: ${responseTime}

Sample messages from Julian to this person:
${samples}

Write a concise style guide (3-4 sentences). Start directly with "Julian texts..." — no preamble:`;
}
