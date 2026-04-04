import { generate, parseJsonResponse } from "../ollama/client.js";
import { config } from "../config.js";
import type {
  MessageRow,
  MessageClassificationRow,
  CommunicationProfile,
  MessageTopic,
} from "../types/index.js";

const ALL_TOPICS: MessageTopic[] = [
  "business", "personal", "logistics", "social", "faith",
  "fitness", "tech", "finance", "family", "other",
];

const PROFILE_PROMPT = `You are a communication style analyzer. Given a sample of text messages from one person, analyze their communication style.

Return a JSON object with these fields:
- "formality_score": number 1-10 (1=very casual/slang, 10=very formal/professional)
- "emoji_frequency": number (average emojis per message, e.g., 0.5 means one emoji every 2 messages)
- "common_emojis": string array of their most used emojis (max 5)
- "greeting_patterns": string array of how they start conversations (e.g., "hey", "yo", "good morning", etc.)
- "signoff_patterns": string array of how they end conversations (e.g., "later", "bye", "talk soon")
- "slang_terms": string array of slang/abbreviations they use (e.g., "ngl", "fr", "bet", "fs")
- "sentiment_baseline": one of "positive", "negative", "neutral", "mixed"
- "message_style": one of "terse" (under 20 chars avg), "moderate" (20-100), "verbose" (100+)
- "uses_caps": boolean (do they use ALL CAPS for emphasis?)
- "uses_punctuation": boolean (do they regularly use periods, commas, etc.?)

Return ONLY valid JSON, no explanation.

Messages (most recent first):
{MESSAGES}

JSON:`;

interface ClassifiedMessage extends MessageRow {
  classification: MessageClassificationRow | null;
}

/**
 * Build or update a communication profile for a contact from their messages.
 */
export async function buildProfile(
  contactId: string,
  messages: ClassifiedMessage[]
): Promise<CommunicationProfile | null> {
  // Filter to only their messages (not from Julian)
  const theirMessages = messages.filter((m) => !m.is_from_me && m.text);
  if (theirMessages.length < 3) return null; // need minimum sample

  // Compute statistical features directly from data
  const stats = computeStats(theirMessages);

  // Use Ollama for qualitative style analysis (patterns, emojis, slang)
  const styleAnalysis = await analyzeStyle(theirMessages);

  // Compute topic distribution from classifications
  const topicDist = computeTopicDistribution(messages);

  // Compute response delays
  const avgDelay = computeAvgResponseDelay(messages);

  // Compute active hours
  const activeHours = computeActiveHours(theirMessages);

  return {
    contact_id: contactId,
    formality_score: styleAnalysis?.formality_score ?? 5,
    avg_message_length: stats.avgLength,
    avg_messages_per_turn: stats.avgMessagesPerTurn,
    emoji_frequency: styleAnalysis?.emoji_frequency ?? stats.emojiFreq,
    common_emojis: styleAnalysis?.common_emojis ?? [],
    greeting_patterns: styleAnalysis?.greeting_patterns ?? [],
    signoff_patterns: styleAnalysis?.signoff_patterns ?? [],
    slang_terms: styleAnalysis?.slang_terms ?? [],
    topic_distribution: topicDist,
    sentiment_baseline: styleAnalysis?.sentiment_baseline ?? "neutral",
    avg_response_delay_minutes: avgDelay,
    active_hours: activeHours,
    message_style: styleAnalysis?.message_style ?? categorizeLength(stats.avgLength),
    uses_caps: styleAnalysis?.uses_caps ?? false,
    uses_punctuation: styleAnalysis?.uses_punctuation ?? true,
    sample_count: theirMessages.length,
    last_analyzed_at: new Date().toISOString(),
  };
}

/**
 * Use Ollama to analyze qualitative style patterns.
 */
async function analyzeStyle(
  messages: MessageRow[]
): Promise<{
  formality_score: number;
  emoji_frequency: number;
  common_emojis: string[];
  greeting_patterns: string[];
  signoff_patterns: string[];
  slang_terms: string[];
  sentiment_baseline: string;
  message_style: "terse" | "moderate" | "verbose";
  uses_caps: boolean;
  uses_punctuation: boolean;
} | null> {
  // Take a representative sample (most recent, capped at 30)
  const sample = messages
    .slice(-30)
    .map((m) => `- ${m.text}`)
    .join("\n");

  const prompt = PROFILE_PROMPT.replace("{MESSAGES}", sample);

  try {
    const raw = await generate(prompt, { temperature: 0.1, numPredict: 512 });
    return parseJsonResponse(raw);
  } catch (err) {
    console.error(
      `Style analysis failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Compute basic statistical features from message text.
 */
function computeStats(messages: MessageRow[]) {
  const lengths = messages.map((m) => m.text?.length ?? 0);
  const avgLength =
    lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);

  // Count emojis per message
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const emojiCounts = messages.map(
    (m) => (m.text?.match(emojiRegex) ?? []).length
  );
  const emojiFreq =
    emojiCounts.reduce((a, b) => a + b, 0) / Math.max(emojiCounts.length, 1);

  // Approximate "messages per turn" — consecutive messages from same sender
  let turns = 0;
  let consecutiveCount = 0;
  const turnCounts: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    consecutiveCount++;
    const nextIsFromMe =
      i + 1 < messages.length ? messages[i + 1].is_from_me : !messages[i].is_from_me;
    if (nextIsFromMe !== messages[i].is_from_me || i === messages.length - 1) {
      turns++;
      turnCounts.push(consecutiveCount);
      consecutiveCount = 0;
    }
  }

  const avgMessagesPerTurn =
    turnCounts.reduce((a, b) => a + b, 0) / Math.max(turns, 1);

  return { avgLength, emojiFreq, avgMessagesPerTurn };
}

/**
 * Compute topic distribution from classified messages.
 */
function computeTopicDistribution(
  messages: ClassifiedMessage[]
): Record<MessageTopic, number> {
  const counts: Record<string, number> = {};
  let total = 0;

  for (const m of messages) {
    if (m.classification?.topic) {
      counts[m.classification.topic] = (counts[m.classification.topic] ?? 0) + 1;
      total++;
    }
  }

  const dist: Record<string, number> = {};
  for (const topic of ALL_TOPICS) {
    dist[topic] = total > 0 ? Math.round(((counts[topic] ?? 0) / total) * 100) : 0;
  }

  return dist as Record<MessageTopic, number>;
}

/**
 * Compute average response delay in minutes.
 * Looks at Julian's message → their reply pairs.
 */
function computeAvgResponseDelay(messages: ClassifiedMessage[]): number | null {
  const delays: number[] = [];

  for (let i = 1; i < messages.length; i++) {
    // Julian sends, then they reply
    if (messages[i - 1].is_from_me && !messages[i].is_from_me) {
      const sent = new Date(messages[i - 1].timestamp).getTime();
      const replied = new Date(messages[i].timestamp).getTime();
      const delayMin = (replied - sent) / 60_000;

      // Filter out unreasonable delays (>24h probably not a response)
      if (delayMin > 0 && delayMin < 1440) {
        delays.push(delayMin);
      }
    }
  }

  if (delays.length === 0) return null;
  return Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
}

/**
 * Determine peak active hours from message timestamps.
 */
function computeActiveHours(messages: MessageRow[]): {
  start: number;
  end: number;
} {
  const hourCounts = new Array(24).fill(0);

  for (const m of messages) {
    const hour = new Date(m.timestamp).getHours();
    hourCounts[hour]++;
  }

  // Find the contiguous window with the most messages
  let bestStart = 8;
  let bestEnd = 21;
  let bestCount = 0;

  for (let start = 0; start < 24; start++) {
    for (let window = 6; window <= 16; window++) {
      let count = 0;
      for (let h = 0; h < window; h++) {
        count += hourCounts[(start + h) % 24];
      }
      if (count > bestCount) {
        bestCount = count;
        bestStart = start;
        bestEnd = (start + window) % 24;
      }
    }
  }

  return { start: bestStart, end: bestEnd };
}

function categorizeLength(avg: number): "terse" | "moderate" | "verbose" {
  if (avg < 20) return "terse";
  if (avg < 100) return "moderate";
  return "verbose";
}
