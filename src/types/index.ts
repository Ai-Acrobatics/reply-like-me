/**
 * Reply Like Me — Shared Types
 *
 * Type definitions for the unified MCP tool spanning
 * Supabase, Pinecone, Obsidian, and Notion data layers.
 */

// ─── Contact ────────────────────────────────────────────────

export interface RlmContact {
  id: string;
  handle_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  relationship_type: RelationshipType | null;
  circle_rank: CircleRank | null;
  first_message_at: string | null;
  last_message_at: string | null;
  total_messages: number;
  total_from_julian: number;
  total_to_julian: number;
  is_active: boolean;
  google_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export type RelationshipType =
  | "family"
  | "friend"
  | "client"
  | "vendor"
  | "mentor"
  | "acquaintance"
  | "unknown";

export type CircleRank = "inner" | "key" | "outer" | "dormant";

// ─── Style Profile ──────────────────────────────────────────

export interface RlmStyleProfile {
  id: string;
  contact_id: string;
  formality_score: number | null;
  sentiment_baseline: number | null;
  humor_frequency: number | null;
  sarcasm_frequency: number | null;
  avg_message_length: number | null;
  avg_words_per_message: number | null;
  messages_per_burst: number | null;
  burst_threshold_seconds: number;
  single_vs_multi_ratio: number | null;
  emoji_frequency: number | null;
  top_emojis: string[] | null;
  exclamation_frequency: number | null;
  question_frequency: number | null;
  caps_usage: "never" | "emphasis_only" | "frequent" | null;
  greeting_patterns: string[] | null;
  signoff_patterns: string[] | null;
  abbreviation_frequency: number | null;
  common_abbreviations: Record<string, number> | null;
  slang_terms: string[] | null;
  topic_distribution: Record<string, number> | null;
  avg_response_time_seconds: number | null;
  response_time_p50: number | null;
  response_time_p90: number | null;
  active_hours: Record<string, number> | null;
  active_days: Record<string, number> | null;
  sample_size: number;
  last_analyzed_at: string | null;
  model_version: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Message ────────────────────────────────────────────────

export interface RlmMessage {
  id: string;
  chat_db_rowid: number;
  contact_id: string;
  handle_id: string;
  is_from_julian: boolean;
  text_content: string | null;
  date_utc: string;
  date_read: string | null;
  date_delivered: string | null;
  is_group_chat: boolean;
  chat_guid: string | null;
  has_attachment: boolean;
  attachment_types: string[] | null;
  is_reaction: boolean;
  reaction_type: string | null;
  pinecone_vector_id: string | null;
  embedding_model: string | null;
  created_at: string;
}

// ─── Attachment ─────────────────────────────────────────────

export interface RlmAttachment {
  id: string;
  message_id: string;
  chat_db_attachment_rowid: number | null;
  filename: string | null;
  mime_type: string | null;
  total_bytes: number | null;
  is_meaningful: boolean | null;
  classification: ImageClassification | null;
  classification_confidence: number | null;
  local_path: string | null;
  pinecone_vector_id: string | null;
  created_at: string;
}

export type ImageClassification =
  | "photo"
  | "screenshot"
  | "meme"
  | "gif"
  | "sticker"
  | "document"
  | "video"
  | "audio";

// ─── Cadence Pattern ────────────────────────────────────────

export interface RlmCadencePattern {
  id: string;
  contact_id: string;
  day_of_week: number;
  hour_of_day: number;
  avg_response_delay_seconds: number;
  median_response_delay_seconds: number;
  message_probability: number;
  avg_burst_length: number;
  sample_count: number;
}

// ─── Response Log ───────────────────────────────────────────

export interface RlmResponseLog {
  id: string;
  contact_id: string;
  incoming_message: string | null;
  generated_response: string | null;
  model_used: string | null;
  style_profile_version: string | null;
  was_sent: boolean;
  was_edited: boolean;
  edited_response: string | null;
  confidence_score: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  created_at: string;
}

// ─── Pinecone Vector Metadata ───────────────────────────────

// Use `type` instead of `interface` so it satisfies Pinecone's
// RecordMetadata index-signature constraint without an explicit
// `[key: string]: unknown` escape hatch.
export type PineconeMessageMetadata = {
  contact_id: string;
  handle_id: string;
  is_from_julian: boolean;
  date_utc: string;
  message_type: "text" | "image" | "conversation_summary";
  supabase_id: string;
};

// ─── Obsidian Contact Summary ───────────────────────────────

export interface ObsidianContactSummary {
  handle: string;
  name: string;
  relationship: string;
  formality: string;
  last_updated: string;
  style_summary: string;
  key_topics: string[];
  patterns: string[];
  sample_exchanges: string;
}

// ─── Semantic Search Result ─────────────────────────────────

export interface SemanticSearchResult {
  id: string;
  score: number;
  metadata: PineconeMessageMetadata;
  text_content?: string;
}

// ═══════════════════════════════════════════════════════════════
// Reply Generation Engine Types (PERS-403)
// ═══════════════════════════════════════════════════════════════

// ─── Contact (simplified view for reply engine) ─────────────

export interface Contact {
  id: string;
  handle_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  relationship_type: RelationshipType | null;
  circle_rank: CircleRank;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Communication Profile (for reply style matching) ───────

export interface CommunicationProfile {
  id: string;
  contact_id: string;
  formality: number;
  avg_message_length: number;
  emoji_frequency: number;
  common_emojis: string[];
  greeting_patterns: string[];
  signoff_patterns: string[];
  slang_terms: string[];
  topic_distribution: Record<string, number>;
  sentiment_baseline: number;
  avg_response_delay_minutes: number;
  avg_bubbles_per_reply: number;
  avg_chars_per_bubble: number;
  sample_messages: string[];
  updated_at: string;
}

// ─── Message (simplified for reply context) ─────────────────

export interface Message {
  id: string;
  contact_id: string;
  handle_id: string;
  text: string;
  is_from_me: boolean;
  timestamp: string;
  thread_id: string | null;
  has_attachment: boolean;
}

// ─── LLM Routing ────────────────────────────────────────────

export type LLMTier = "premium" | "standard" | "budget";
export type LLMProvider = "claude" | "deepseek" | "ollama";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  tier: LLMTier;
  endpoint: string;
  apiKey?: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponse {
  text: string;
  provider: LLMProvider;
  model: string;
  tokensUsed: number;
}

// ─── Reply Context & Generation ─────────────────────────────

export interface ReplyContext {
  contact: Contact;
  profile: CommunicationProfile | null;
  recentMessages: Message[];
  similarMessages: SimilarMessage[];
  incomingMessage: string;
}

export interface SimilarMessage {
  text: string;
  score: number;
  is_from_me: boolean;
  contact_name: string | null;
  timestamp: string;
}

export interface GeneratedReply {
  bubbles: string[];
  llm_provider: LLMProvider;
  llm_model: string;
  confidence: number;
  reasoning: string;
}

// ─── Draft Reply ────────────────────────────────────────────

export interface DraftReply {
  id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  incoming_message: string;
  bubbles: string[];
  llm_provider: LLMProvider;
  llm_model: string;
  confidence: number;
  reasoning: string;
  status: "pending" | "accepted" | "edited" | "rejected" | "sent";
  edited_bubbles: string[] | null;
  created_at: string;
  reviewed_at: string | null;
}
