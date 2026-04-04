/** Raw message row from Supabase `messages` table */
export interface MessageRow {
  id: string;
  contact_id: string | null;
  handle_id: string | null;
  text: string | null;
  is_from_me: boolean;
  timestamp: string;
  chat_id: string | null;
  has_attachment: boolean;
  service: string | null;
  created_at: string;
}

/** Classification result from Ollama */
export interface MessageClassification {
  intent: MessageIntent;
  topic: MessageTopic;
  urgency: "high" | "medium" | "low";
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  confidence: number;
}

export type MessageIntent =
  | "question"
  | "statement"
  | "request"
  | "greeting"
  | "farewell"
  | "humor"
  | "emotional"
  | "informational"
  | "logistics"
  | "acknowledgment";

export type MessageTopic =
  | "business"
  | "personal"
  | "logistics"
  | "social"
  | "faith"
  | "fitness"
  | "tech"
  | "finance"
  | "family"
  | "other";

/** Per-message classification stored in Supabase */
export interface MessageClassificationRow {
  id?: string;
  message_id: string;
  intent: MessageIntent;
  topic: MessageTopic;
  urgency: string;
  sentiment: string;
  confidence: number;
  raw_analysis: string | null;
  model_used: string;
  processed_at: string;
}

/** Per-contact communication profile */
export interface CommunicationProfile {
  contact_id: string;
  formality_score: number; // 1-10
  avg_message_length: number;
  avg_messages_per_turn: number;
  emoji_frequency: number; // emojis per message
  common_emojis: string[];
  greeting_patterns: string[];
  signoff_patterns: string[];
  slang_terms: string[];
  topic_distribution: Record<MessageTopic, number>; // percentages
  sentiment_baseline: string;
  avg_response_delay_minutes: number | null;
  active_hours: { start: number; end: number };
  message_style: "terse" | "moderate" | "verbose";
  uses_caps: boolean;
  uses_punctuation: boolean;
  sample_count: number;
  last_analyzed_at: string;
}

/** Ollama /api/generate request */
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
  };
}

/** Ollama /api/generate response */
export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/** Pipeline processing result */
export interface PipelineResult {
  messagesProcessed: number;
  classificationsCreated: number;
  profilesUpdated: number;
  errors: string[];
  durationMs: number;
}
