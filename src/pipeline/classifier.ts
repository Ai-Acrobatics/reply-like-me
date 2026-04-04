import { generate, parseJsonResponse } from "../ollama/client.js";
import { config } from "../config.js";
import type {
  MessageRow,
  MessageClassification,
  MessageClassificationRow,
} from "../types/index.js";

const CLASSIFICATION_PROMPT = `You are a message classification engine. Analyze the following text message and return a JSON object with these fields:

- "intent": one of "question", "statement", "request", "greeting", "farewell", "humor", "emotional", "informational", "logistics", "acknowledgment"
- "topic": one of "business", "personal", "logistics", "social", "faith", "fitness", "tech", "finance", "family", "other"
- "urgency": one of "high", "medium", "low"
- "sentiment": one of "positive", "negative", "neutral", "mixed"
- "confidence": a number from 0 to 1 indicating your confidence

Rules:
- "high" urgency = needs reply within hours (time-sensitive, money, emergencies)
- "medium" urgency = should reply today
- "low" urgency = can reply whenever (casual chat, memes, FYI)
- For very short messages like "ok", "lol", "yeah" → intent is "acknowledgment", urgency is "low"
- Return ONLY valid JSON, no explanation.

Message: "{TEXT}"

JSON:`;

/**
 * Classify a single message using Ollama.
 */
export async function classifyMessage(
  message: MessageRow
): Promise<MessageClassification | null> {
  const text = message.text?.trim();
  if (!text || text.length === 0) return null;

  // Skip very short noise (single emoji, reaction, etc.)
  if (text.length <= 2 && !/[a-zA-Z]/.test(text)) return null;

  const prompt = CLASSIFICATION_PROMPT.replace("{TEXT}", text.replace(/"/g, '\\"'));

  try {
    const raw = await generate(prompt, { temperature: 0.05, numPredict: 256 });
    return parseJsonResponse<MessageClassification>(raw);
  } catch (err) {
    console.error(
      `Classification failed for message ${message.id}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Classify a batch of messages, returning classification rows ready for insert.
 */
export async function classifyBatch(
  messages: MessageRow[]
): Promise<MessageClassificationRow[]> {
  const results: MessageClassificationRow[] = [];

  for (const message of messages) {
    const classification = await classifyMessage(message);
    if (!classification) continue;

    results.push({
      message_id: message.id,
      intent: classification.intent,
      topic: classification.topic,
      urgency: classification.urgency,
      sentiment: classification.sentiment,
      confidence: classification.confidence,
      raw_analysis: null,
      model_used: config.ollama.model,
      processed_at: new Date().toISOString(),
    });

    // Log progress every 10 messages
    if (results.length % 10 === 0) {
      console.log(`  Classified ${results.length}/${messages.length} messages`);
    }
  }

  return results;
}
