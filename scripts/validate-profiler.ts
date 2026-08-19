#!/usr/bin/env npx tsx
/**
 * Validation script for the NLP profiler.
 * Runs basic assertions against the text-analyzer and cadence-analyzer.
 */

import { analyzeTexts } from "../src/profiler/text-analyzer.js";
import { analyzeCadence } from "../src/profiler/cadence-analyzer.js";
import type { RlmMessage } from "../src/types/index.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

function makeMsg(
  text: string,
  isFromJulian: boolean,
  dateUtc: string,
  overrides: Partial<RlmMessage> = {}
): RlmMessage {
  return {
    id: crypto.randomUUID(),
    chat_db_rowid: Math.floor(Math.random() * 1e6),
    contact_id: "test-contact",
    handle_id: "+15551234567",
    is_from_julian: isFromJulian,
    text_content: text,
    date_utc: dateUtc,
    date_read: null,
    date_delivered: null,
    is_group_chat: false,
    chat_guid: null,
    has_attachment: false,
    attachment_types: null,
    is_reaction: false,
    reaction_type: null,
    pinecone_vector_id: null,
    embedding_model: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Text Analyzer ─────────────────────────────────────────────────

console.log("\n=== Text Analyzer ===\n");

const emptyResult = analyzeTexts([]);
assert(emptyResult.sample_size === 0, "empty input returns 0 sample_size");
assert(emptyResult.formality_score === 5.0, "empty input returns neutral formality");

const mixedMsgs = [
  makeMsg("hey what's up", false, "2026-01-01T10:00:00Z"),
  makeMsg("yo", true, "2026-01-01T10:01:00Z"),
];
const mixedResult = analyzeTexts(mixedMsgs);
assert(mixedResult.sample_size === 1, "only counts Julian's messages");

const emojiMsgs = [
  makeMsg("hey 😂😂😂", true, "2026-01-01T10:00:00Z"),
  makeMsg("what 🔥", true, "2026-01-01T10:01:00Z"),
  makeMsg("no emojis", true, "2026-01-01T10:02:00Z"),
];
const emojiResult = analyzeTexts(emojiMsgs);
assert(emojiResult.emoji_frequency > 0, "detects emoji frequency");
assert(emojiResult.top_emojis[0] === "😂", "ranks emojis by frequency");

const abbrevMsgs = [
  makeMsg("u gonna be there?", true, "2026-01-01T10:00:00Z"),
  makeMsg("nah im good lol", true, "2026-01-01T10:01:00Z"),
  makeMsg("lmk when ur free", true, "2026-01-01T10:02:00Z"),
];
const abbrevResult = analyzeTexts(abbrevMsgs);
assert(abbrevResult.abbreviation_frequency > 0, "detects abbreviation frequency");
assert("u" in abbrevResult.common_abbreviations, "detects 'u' abbreviation");
assert("lol" in abbrevResult.common_abbreviations, "detects 'lol' abbreviation");

const casualMsgs = [
  makeMsg("yo whats good", true, "2026-01-01T10:00:00Z"),
  makeMsg("lol nah", true, "2026-01-01T10:01:00Z"),
  makeMsg("bet", true, "2026-01-01T10:02:00Z"),
  makeMsg("aight cya", true, "2026-01-01T10:03:00Z"),
];
const casualResult = analyzeTexts(casualMsgs);
assert(casualResult.formality_score < 5, "casual messages score < 5 formality");

const formalMsgs = [
  makeMsg("Hello, I wanted to follow up on our discussion.", true, "2026-01-01T10:00:00Z"),
  makeMsg("Please let me know if you have any questions.", true, "2026-01-01T10:01:00Z"),
  makeMsg("Thank you for your time. I appreciate your help.", true, "2026-01-01T10:02:00Z"),
];
const formalResult = analyzeTexts(formalMsgs);
assert(formalResult.formality_score > 5, "formal messages score > 5 formality");

const positiveMsgs = [
  makeMsg("that's awesome!", true, "2026-01-01T10:00:00Z"),
  makeMsg("love it", true, "2026-01-01T10:01:00Z"),
  makeMsg("great job", true, "2026-01-01T10:02:00Z"),
];
const positiveResult = analyzeTexts(positiveMsgs);
assert(positiveResult.sentiment_baseline > 0, "detects positive sentiment");

const negativeMsgs = [
  makeMsg("that sucks", true, "2026-01-01T10:00:00Z"),
  makeMsg("so annoying", true, "2026-01-01T10:01:00Z"),
  makeMsg("hate this", true, "2026-01-01T10:02:00Z"),
];
const negativeResult = analyzeTexts(negativeMsgs);
assert(negativeResult.sentiment_baseline < 0, "detects negative sentiment");

const humorMsgs = [
  makeMsg("haha that's wild", true, "2026-01-01T10:00:00Z"),
  makeMsg("lmao no way", true, "2026-01-01T10:01:00Z"),
  makeMsg("regular message", true, "2026-01-01T10:02:00Z"),
];
const humorResult = analyzeTexts(humorMsgs);
assert(humorResult.humor_frequency > 0.5, "detects humor markers");

// ── Cadence Analyzer ──────────────────────────────────────────────

console.log("\n=== Cadence Analyzer ===\n");

const emptyCadence = analyzeCadence([]);
assert(emptyCadence.sample_size === 0, "empty input returns 0 sample_size");
assert(emptyCadence.avg_response_time_seconds === null, "empty input returns null response time");

// Build a conversation with known timing
const now = new Date("2026-01-15T14:00:00Z");
const conversationMsgs: RlmMessage[] = [
  // Incoming, then Julian responds 60s later
  makeMsg("hey are you free?", false, new Date(now.getTime()).toISOString()),
  makeMsg("yeah what's up", true, new Date(now.getTime() + 60_000).toISOString()),
  // Incoming, Julian responds 120s later with a 2-message burst
  makeMsg("can you review this?", false, new Date(now.getTime() + 300_000).toISOString()),
  makeMsg("sure", true, new Date(now.getTime() + 420_000).toISOString()),
  makeMsg("send it over", true, new Date(now.getTime() + 440_000).toISOString()),
  // Another exchange, Julian responds 180s later
  makeMsg("thanks!", false, new Date(now.getTime() + 600_000).toISOString()),
  makeMsg("np", true, new Date(now.getTime() + 780_000).toISOString()),
];

const cadenceResult = analyzeCadence(conversationMsgs);
assert(cadenceResult.sample_size === 7, "counts all messages");
assert(cadenceResult.avg_response_time_seconds !== null, "calculates avg response time");
assert(cadenceResult.avg_response_time_seconds! > 50, "response time > 50s");
assert(cadenceResult.avg_response_time_seconds! < 200, "response time < 200s");
assert(cadenceResult.messages_per_burst >= 1, "messages per burst >= 1");
assert(cadenceResult.single_vs_multi_ratio >= 0 && cadenceResult.single_vs_multi_ratio <= 1, "single_vs_multi ratio between 0 and 1");
assert(Object.keys(cadenceResult.active_hours).length > 0, "detects active hours");
assert(cadenceResult.hourly_patterns.length > 0, "generates hourly patterns");

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
