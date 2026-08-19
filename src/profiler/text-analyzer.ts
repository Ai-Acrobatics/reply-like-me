/**
 * Text Analyzer — Reply Like Me
 *
 * Pure NLP analysis of Julian's outgoing messages to a specific contact.
 * No LLM calls — all heuristic/regex based for speed and zero cost.
 *
 * Analyzes: formality, emoji usage, abbreviations, greetings/signoffs,
 * message length, question/exclamation frequency, capitalization patterns.
 */

import type { RlmMessage } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────

export interface TextAnalysisResult {
  formality_score: number; // 1.0 (very casual) to 10.0 (very formal)
  avg_message_length: number; // chars per message
  avg_words_per_message: number;
  emoji_frequency: number; // emojis per message (0.0+)
  top_emojis: string[]; // top 10 most used
  exclamation_frequency: number; // ratio of messages containing !
  question_frequency: number; // ratio of messages containing ?
  caps_usage: "never" | "emphasis_only" | "frequent";
  greeting_patterns: string[]; // most common greetings
  signoff_patterns: string[]; // most common signoffs
  abbreviation_frequency: number; // ratio of messages with abbreviations
  common_abbreviations: Record<string, number>; // abbreviation → frequency
  slang_terms: string[]; // contact-specific slang
  sentiment_baseline: number; // -1.0 to 1.0 (simple lexicon)
  humor_frequency: number; // ratio of messages with humor markers
  sample_size: number;
}

// ─── Emoji Detection ──────────────────────────────────────────────

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{231A}\u{231B}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2934}\u{2935}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;

function extractEmojis(text: string): string[] {
  return text.match(EMOJI_REGEX) ?? [];
}

// ─── Abbreviation Detection ────────────────────────────────────────

const COMMON_ABBREVIATIONS: Record<string, string> = {
  u: "you",
  ur: "your/you're",
  r: "are",
  y: "why",
  k: "ok",
  kk: "ok ok",
  bc: "because",
  w: "with",
  b4: "before",
  "2": "to/too",
  "4": "for",
  rn: "right now",
  ngl: "not gonna lie",
  tbh: "to be honest",
  imo: "in my opinion",
  smh: "shaking my head",
  lmk: "let me know",
  lmao: "laughing my ass off",
  lol: "laughing out loud",
  omg: "oh my god",
  nah: "no",
  ya: "yeah/you",
  yea: "yeah",
  yah: "yeah",
  aight: "alright",
  ight: "alright",
  brb: "be right back",
  idk: "I don't know",
  nvm: "never mind",
  dm: "direct message",
  prob: "probably",
  def: "definitely",
  obv: "obviously",
  pls: "please",
  plz: "please",
  thx: "thanks",
  ty: "thank you",
  np: "no problem",
  tho: "though",
  cuz: "because",
  gonna: "going to",
  wanna: "want to",
  gotta: "got to",
  tryna: "trying to",
  finna: "fixing to",
  boutta: "about to",
  lowkey: "lowkey",
  highkey: "highkey",
  hmu: "hit me up",
  wya: "where you at",
  wyd: "what you doing",
  bet: "bet/agreed",
  word: "word/agreed",
  fam: "family/friend",
  bro: "bro/brother",
  bruh: "bruh",
  dawg: "dawg/friend",
  fs: "for sure",
  ong: "on god",
  "no cap": "no lie",
  cap: "lie",
  fr: "for real",
  irl: "in real life",
  goat: "greatest of all time",
  w: "win",
  L: "loss",
};

function detectAbbreviations(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const found: string[] = [];

  for (const word of words) {
    const cleaned = word.replace(/[.,!?;:'"()]/g, "");
    if (COMMON_ABBREVIATIONS[cleaned]) {
      found.push(cleaned);
    }
  }

  // Multi-word abbreviations
  const lower = text.toLowerCase();
  for (const abbr of ["no cap"]) {
    if (lower.includes(abbr)) found.push(abbr);
  }

  return found;
}

// ─── Greeting / Sign-off Detection ─────────────────────────────────

const GREETING_PATTERNS = [
  /^(hey|hi|hello|yo|sup|what'?s? ?up|morning|good morning|good evening|evening|howdy|hola|ayo)\b/i,
  /^(hey man|hey bro|hey dude|hey fam|what up|whats good|hey there|hi there)\b/i,
];

const SIGNOFF_PATTERNS = [
  /\b(later|peace|bye|goodnight|gn|ttyl|talk soon|see ya|see you|take care|night|cya|cheers|deuces|adios)\s*[.!]?\s*$/i,
  /\b(aight|bet|word|love you|love u|much love)\s*[.!]?\s*$/i,
];

function detectGreeting(text: string): string | null {
  const trimmed = text.trim();
  for (const pattern of GREETING_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[0].toLowerCase();
  }
  return null;
}

function detectSignoff(text: string): string | null {
  const trimmed = text.trim();
  for (const pattern of SIGNOFF_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[0].toLowerCase().trim();
  }
  return null;
}

// ─── Sentiment (simple lexicon-based) ──────────────────────────────

const POSITIVE_WORDS = new Set([
  "love",
  "great",
  "amazing",
  "awesome",
  "good",
  "nice",
  "dope",
  "fire",
  "sick",
  "perfect",
  "beautiful",
  "excellent",
  "fantastic",
  "happy",
  "excited",
  "thanks",
  "thank",
  "appreciate",
  "glad",
  "cool",
  "lit",
  "blessed",
  "haha",
  "lol",
  "lmao",
  "yes",
  "yeah",
  "yea",
  "yep",
  "absolutely",
  "definitely",
  "congrats",
  "proud",
  "brilliant",
  "incredible",
  "wonderful",
]);

const NEGATIVE_WORDS = new Set([
  "hate",
  "bad",
  "terrible",
  "awful",
  "sucks",
  "horrible",
  "annoying",
  "frustrated",
  "angry",
  "sad",
  "disappointed",
  "sorry",
  "unfortunately",
  "worst",
  "ugly",
  "boring",
  "trash",
  "garbage",
  "stupid",
  "dumb",
  "no",
  "nah",
  "nope",
  "never",
  "wrong",
  "broken",
  "fail",
  "failed",
  "smh",
  "ugh",
  "damn",
]);

function analyzeSentiment(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let positive = 0;
  let negative = 0;

  for (const word of words) {
    const clean = word.replace(/[.,!?;:'"()]/g, "");
    if (POSITIVE_WORDS.has(clean)) positive++;
    if (NEGATIVE_WORDS.has(clean)) negative++;
  }

  const total = positive + negative;
  if (total === 0) return 0;
  return (positive - negative) / total; // -1.0 to 1.0
}

// ─── Humor Detection ──────────────────────────────────────────────

const HUMOR_MARKERS = [
  /\blol\b/i,
  /\blmao\b/i,
  /\blmfao\b/i,
  /\bhaha/i,
  /\bhehe/i,
  /\bjk\b/i,
  /\bdeadass\b/i,
  /\b💀\b/,
  /😂/,
  /🤣/,
  /😭/, // crying-laughing usage
  /\bim dead\b/i,
  /\bi'm dead\b/i,
  /\bno way\b/i,
  /\bbruh\b/i,
];

function hasHumorMarkers(text: string): boolean {
  return HUMOR_MARKERS.some((re) => re.test(text));
}

// ─── Formality Scoring ────────────────────────────────────────────

function scoreFormality(messages: string[]): number {
  if (messages.length === 0) return 5.0;

  let totalScore = 0;

  for (const msg of messages) {
    let score = 5.0; // neutral start

    // Informal signals (lower score)
    const abbrevs = detectAbbreviations(msg);
    score -= Math.min(abbrevs.length * 0.5, 2.0);

    const emojis = extractEmojis(msg);
    score -= Math.min(emojis.length * 0.3, 1.5);

    if (hasHumorMarkers(msg)) score -= 0.5;

    // No capitalization at start
    if (msg.length > 0 && msg[0] === msg[0].toLowerCase() && /[a-z]/.test(msg[0])) {
      score -= 0.3;
    }

    // No punctuation at end
    if (msg.length > 0 && !/[.!?]$/.test(msg.trim())) {
      score -= 0.3;
    }

    // Formal signals (higher score)
    if (/^(Hi|Hello|Good (morning|afternoon|evening))\b/.test(msg)) score += 1.0;
    if (/\b(please|thank you|appreciate|regards|sincerely)\b/i.test(msg)) score += 0.5;
    if (/\b(per our|as discussed|following up|pursuant)\b/i.test(msg)) score += 1.5;

    // Message length (longer = more formal generally)
    const words = msg.split(/\s+/).length;
    if (words > 20) score += 0.5;
    if (words < 5) score -= 0.3;

    // Complete sentences with periods
    const sentences = msg.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length > 1) score += 0.3;

    totalScore += Math.max(1, Math.min(10, score));
  }

  return Math.round((totalScore / messages.length) * 10) / 10;
}

// ─── Caps Usage Detection ──────────────────────────────────────────

function analyzeCapsUsage(messages: string[]): "never" | "emphasis_only" | "frequent" {
  if (messages.length === 0) return "never";

  let allCapsWordCount = 0;
  let totalWords = 0;

  for (const msg of messages) {
    const words = msg.split(/\s+/).filter((w) => w.length > 1);
    for (const word of words) {
      totalWords++;
      // Ignore emojis and common all-caps words
      const cleaned = word.replace(EMOJI_REGEX, "").replace(/[.,!?;:'"()]/g, "");
      if (
        cleaned.length > 1 &&
        cleaned === cleaned.toUpperCase() &&
        /[A-Z]/.test(cleaned) &&
        !["OK", "I", "ID", "URL", "API", "AI", "AM", "PM", "CEO", "CTO"].includes(cleaned)
      ) {
        allCapsWordCount++;
      }
    }
  }

  if (totalWords === 0) return "never";

  const ratio = allCapsWordCount / totalWords;
  if (ratio < 0.005) return "never";
  if (ratio < 0.03) return "emphasis_only";
  return "frequent";
}

// ─── Main Analysis Function ────────────────────────────────────────

export function analyzeTexts(messages: RlmMessage[]): TextAnalysisResult {
  // Filter to Julian's outgoing messages with text content
  const julianMessages = messages.filter(
    (m) => m.is_from_julian && m.text_content && m.text_content.trim().length > 0 && !m.is_reaction
  );

  const texts = julianMessages.map((m) => m.text_content!);
  const sampleSize = texts.length;

  if (sampleSize === 0) {
    return emptyResult();
  }

  // ── Message Length ─────────────────────────────────
  const lengths = texts.map((t) => t.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / sampleSize;

  const wordCounts = texts.map((t) => t.split(/\s+/).filter(Boolean).length);
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / sampleSize;

  // ── Emoji Analysis ─────────────────────────────────
  const emojiCounts: Record<string, number> = {};
  let totalEmojiCount = 0;

  for (const text of texts) {
    const emojis = extractEmojis(text);
    totalEmojiCount += emojis.length;
    for (const emoji of emojis) {
      emojiCounts[emoji] = (emojiCounts[emoji] ?? 0) + 1;
    }
  }

  const emojiFreq = totalEmojiCount / sampleSize;
  const topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji]) => emoji);

  // ── Punctuation Frequency ──────────────────────────
  const exclamationCount = texts.filter((t) => t.includes("!")).length;
  const questionCount = texts.filter((t) => t.includes("?")).length;

  // ── Abbreviations ──────────────────────────────────
  const abbrevCounts: Record<string, number> = {};
  let messagesWithAbbrevs = 0;

  for (const text of texts) {
    const found = detectAbbreviations(text);
    if (found.length > 0) messagesWithAbbrevs++;
    for (const abbrev of found) {
      abbrevCounts[abbrev] = (abbrevCounts[abbrev] ?? 0) + 1;
    }
  }

  // Normalize abbreviation counts to frequency (0-1)
  const totalAbbrevInstances = Object.values(abbrevCounts).reduce((a, b) => a + b, 0);
  const commonAbbreviations: Record<string, number> = {};
  for (const [abbr, count] of Object.entries(abbrevCounts)) {
    commonAbbreviations[abbr] = Math.round((count / sampleSize) * 1000) / 1000;
  }

  // ── Greetings & Sign-offs ─────────────────────────
  const greetingCounts: Record<string, number> = {};
  const signoffCounts: Record<string, number> = {};

  for (const text of texts) {
    const greeting = detectGreeting(text);
    if (greeting) {
      greetingCounts[greeting] = (greetingCounts[greeting] ?? 0) + 1;
    }
    const signoff = detectSignoff(text);
    if (signoff) {
      signoffCounts[signoff] = (signoffCounts[signoff] ?? 0) + 1;
    }
  }

  const greetingPatterns = Object.entries(greetingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  const signoffPatterns = Object.entries(signoffCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s);

  // ── Slang Detection ────────────────────────────────
  // Slang = abbreviations that appear more than 3 times and aren't standard
  const slangTerms = Object.entries(abbrevCounts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([term]) => term);

  // ── Sentiment ──────────────────────────────────────
  const sentiments = texts.map(analyzeSentiment);
  const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sampleSize;

  // ── Humor ──────────────────────────────────────────
  const humorCount = texts.filter(hasHumorMarkers).length;

  // ── Formality ──────────────────────────────────────
  const formalityScore = scoreFormality(texts);

  // ── Caps ───────────────────────────────────────────
  const capsUsage = analyzeCapsUsage(texts);

  return {
    formality_score: formalityScore,
    avg_message_length: Math.round(avgLength * 10) / 10,
    avg_words_per_message: Math.round(avgWords * 10) / 10,
    emoji_frequency: Math.round(emojiFreq * 1000) / 1000,
    top_emojis: topEmojis,
    exclamation_frequency: Math.round((exclamationCount / sampleSize) * 1000) / 1000,
    question_frequency: Math.round((questionCount / sampleSize) * 1000) / 1000,
    caps_usage: capsUsage,
    greeting_patterns: greetingPatterns,
    signoff_patterns: signoffPatterns,
    abbreviation_frequency: Math.round((messagesWithAbbrevs / sampleSize) * 1000) / 1000,
    common_abbreviations: commonAbbreviations,
    slang_terms: slangTerms,
    sentiment_baseline: Math.round(avgSentiment * 1000) / 1000,
    humor_frequency: Math.round((humorCount / sampleSize) * 1000) / 1000,
    sample_size: sampleSize,
  };
}

// ─── Empty result for contacts with no messages ─────────────────────

function emptyResult(): TextAnalysisResult {
  return {
    formality_score: 5.0,
    avg_message_length: 0,
    avg_words_per_message: 0,
    emoji_frequency: 0,
    top_emojis: [],
    exclamation_frequency: 0,
    question_frequency: 0,
    caps_usage: "never",
    greeting_patterns: [],
    signoff_patterns: [],
    abbreviation_frequency: 0,
    common_abbreviations: {},
    slang_terms: [],
    sentiment_baseline: 0,
    humor_frequency: 0,
    sample_size: 0,
  };
}
