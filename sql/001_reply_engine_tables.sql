-- Reply Like Me — Complete Schema
-- Run against Supabase project jrirksdiklqwsaatbhvg
--
-- Tables (all prefixed rlm_ to avoid collisions):
--   1. rlm_contacts         — unified contact registry with relationship metadata
--   2. rlm_style_profiles   — per-contact communication style attributes
--   3. rlm_messages         — message history (synced from chat.db on Mac Mini)
--   4. rlm_attachments      — message attachments with classification
--   5. rlm_cadence_patterns — per-contact timing/activity patterns by hour and day
--   6. rlm_draft_replies    — generated drafts awaiting Julian's review
--   7. rlm_response_log     — feedback loop: what was sent, edited, rejected
--
-- Matches TypeScript types in src/types/index.ts exactly.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CONTACTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle_id         TEXT NOT NULL,
  display_name      TEXT,
  phone             TEXT,
  email             TEXT,

  -- Relationship metadata
  relationship_type TEXT CHECK (relationship_type IN (
    'family', 'friend', 'client', 'vendor', 'mentor',
    'acquaintance', 'unknown'
  )),
  circle_rank       TEXT NOT NULL DEFAULT 'outer' CHECK (circle_rank IN (
    'inner', 'key', 'outer', 'dormant'
  )),

  -- Activity stats (updated by sync pipeline)
  first_message_at  TIMESTAMPTZ,
  last_message_at   TIMESTAMPTZ,
  total_messages    INTEGER NOT NULL DEFAULT 0,
  total_from_julian INTEGER NOT NULL DEFAULT 0,
  total_to_julian   INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,

  -- Cross-references
  google_contact_id TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rlm_contacts_handle_idx ON rlm_contacts(handle_id);
CREATE INDEX IF NOT EXISTS rlm_contacts_phone_idx ON rlm_contacts(phone);
CREATE INDEX IF NOT EXISTS rlm_contacts_email_idx ON rlm_contacts(email);
CREATE INDEX IF NOT EXISTS rlm_contacts_circle_idx ON rlm_contacts(circle_rank);
CREATE INDEX IF NOT EXISTS rlm_contacts_active_idx ON rlm_contacts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS rlm_contacts_total_msgs_idx ON rlm_contacts(total_messages DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. STYLE PROFILES
-- Per-contact style attributes for reply generation. One profile per contact.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_style_profiles (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id                  UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,

  -- Tone & personality
  formality_score             SMALLINT CHECK (formality_score BETWEEN 1 AND 10),
  sentiment_baseline          REAL CHECK (sentiment_baseline BETWEEN -1 AND 1),
  humor_frequency             REAL CHECK (humor_frequency BETWEEN 0 AND 1),
  sarcasm_frequency           REAL CHECK (sarcasm_frequency BETWEEN 0 AND 1),

  -- Message structure
  avg_message_length          INTEGER,
  avg_words_per_message       INTEGER,
  messages_per_burst          INTEGER,
  burst_threshold_seconds     INTEGER NOT NULL DEFAULT 300,
  single_vs_multi_ratio       REAL CHECK (single_vs_multi_ratio BETWEEN 0 AND 1),

  -- Punctuation & emoji
  emoji_frequency             REAL CHECK (emoji_frequency BETWEEN 0 AND 1),
  top_emojis                  JSONB NOT NULL DEFAULT '[]',
  exclamation_frequency       REAL CHECK (exclamation_frequency BETWEEN 0 AND 1),
  question_frequency          REAL CHECK (question_frequency BETWEEN 0 AND 1),
  caps_usage                  TEXT CHECK (caps_usage IN ('never', 'emphasis_only', 'frequent')),

  -- Language patterns
  greeting_patterns           JSONB NOT NULL DEFAULT '[]',
  signoff_patterns            JSONB NOT NULL DEFAULT '[]',
  abbreviation_frequency      REAL CHECK (abbreviation_frequency BETWEEN 0 AND 1),
  common_abbreviations        JSONB NOT NULL DEFAULT '{}',
  slang_terms                 JSONB NOT NULL DEFAULT '[]',

  -- Content analysis
  topic_distribution          JSONB NOT NULL DEFAULT '{}',

  -- Response timing
  avg_response_time_seconds   REAL,
  response_time_p50           REAL,
  response_time_p90           REAL,
  active_hours                JSONB NOT NULL DEFAULT '{}',
  active_days                 JSONB NOT NULL DEFAULT '{}',

  -- Model metadata
  sample_size                 INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at            TIMESTAMPTZ,
  model_version               TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rlm_style_profiles_contact_idx
  ON rlm_style_profiles(contact_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MESSAGES
-- iMessage history synced from chat.db on Mac Mini via SSH polling.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_db_rowid         INTEGER NOT NULL,
  contact_id            UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,
  handle_id             TEXT NOT NULL,

  -- Content
  is_from_julian        BOOLEAN NOT NULL DEFAULT false,
  text_content          TEXT,
  date_utc              TIMESTAMPTZ NOT NULL,
  date_read             TIMESTAMPTZ,
  date_delivered        TIMESTAMPTZ,

  -- Chat context
  is_group_chat         BOOLEAN NOT NULL DEFAULT false,
  chat_guid             TEXT,

  -- Attachments
  has_attachment        BOOLEAN NOT NULL DEFAULT false,
  attachment_types      JSONB,

  -- Reactions (tapbacks)
  is_reaction           BOOLEAN NOT NULL DEFAULT false,
  reaction_type         TEXT,

  -- Embeddings
  pinecone_vector_id    TEXT,
  embedding_model       TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rlm_messages_rowid_idx ON rlm_messages(chat_db_rowid);
CREATE INDEX IF NOT EXISTS rlm_messages_contact_idx ON rlm_messages(contact_id);
CREATE INDEX IF NOT EXISTS rlm_messages_date_idx ON rlm_messages(date_utc DESC);
CREATE INDEX IF NOT EXISTS rlm_messages_contact_date_idx ON rlm_messages(contact_id, date_utc DESC);
CREATE INDEX IF NOT EXISTS rlm_messages_handle_idx ON rlm_messages(handle_id);
CREATE INDEX IF NOT EXISTS rlm_messages_chat_guid_idx ON rlm_messages(chat_guid);
CREATE INDEX IF NOT EXISTS rlm_messages_vector_idx ON rlm_messages(pinecone_vector_id)
  WHERE pinecone_vector_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. ATTACHMENTS
-- Message attachments with classification for meaningful image detection.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_attachments (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id                    UUID NOT NULL REFERENCES rlm_messages(id) ON DELETE CASCADE,
  chat_db_attachment_rowid      INTEGER,

  -- File metadata
  filename                      TEXT,
  mime_type                     TEXT,
  total_bytes                   BIGINT,

  -- AI classification
  is_meaningful                 BOOLEAN,
  classification                TEXT CHECK (classification IN (
    'photo', 'screenshot', 'meme', 'gif', 'sticker',
    'document', 'video', 'audio'
  )),
  classification_confidence     REAL CHECK (classification_confidence BETWEEN 0 AND 1),

  -- Local file reference (on Mac Mini)
  local_path                    TEXT,

  -- Embeddings (for semantic image search)
  pinecone_vector_id            TEXT,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rlm_attachments_message_idx ON rlm_attachments(message_id);
CREATE INDEX IF NOT EXISTS rlm_attachments_classification_idx ON rlm_attachments(classification);
CREATE INDEX IF NOT EXISTS rlm_attachments_meaningful_idx ON rlm_attachments(is_meaningful)
  WHERE is_meaningful = true;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. CADENCE PATTERNS
-- Per-contact, per-timeslot response timing for the cadence model.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_cadence_patterns (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id                     UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,

  day_of_week                    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day                    SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),

  avg_response_delay_seconds     REAL NOT NULL DEFAULT 0,
  median_response_delay_seconds  REAL NOT NULL DEFAULT 0,
  message_probability            REAL NOT NULL DEFAULT 0 CHECK (message_probability BETWEEN 0 AND 1),
  avg_burst_length               REAL NOT NULL DEFAULT 1,
  sample_count                   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS rlm_cadence_contact_idx ON rlm_cadence_patterns(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS rlm_cadence_contact_slot_idx
  ON rlm_cadence_patterns(contact_id, day_of_week, hour_of_day);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. DRAFT REPLIES
-- AI-generated reply drafts awaiting Julian's review in the dashboard.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_draft_replies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,
  contact_name      TEXT,
  contact_phone     TEXT,

  incoming_message  TEXT NOT NULL,
  bubbles           JSONB NOT NULL DEFAULT '[]',

  -- LLM metadata
  llm_provider      TEXT NOT NULL,
  llm_model         TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  reasoning         TEXT,

  -- Review workflow
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'edited', 'rejected', 'sent'
  )),
  edited_bubbles    JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rlm_drafts_status_idx ON rlm_draft_replies(status);
CREATE INDEX IF NOT EXISTS rlm_drafts_contact_idx ON rlm_draft_replies(contact_id);
CREATE INDEX IF NOT EXISTS rlm_drafts_created_idx ON rlm_draft_replies(created_at DESC);
CREATE INDEX IF NOT EXISTS rlm_drafts_pending_idx ON rlm_draft_replies(created_at DESC)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════
-- 7. RESPONSE LOG
-- Feedback loop: tracks every generated response, whether it was sent,
-- edited, or rejected. Used to improve the style model over time.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rlm_response_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,

  incoming_message      TEXT,
  generated_response    TEXT,
  model_used            TEXT,
  style_profile_version TEXT,

  was_sent              BOOLEAN NOT NULL DEFAULT false,
  was_edited            BOOLEAN NOT NULL DEFAULT false,
  edited_response       TEXT,

  confidence_score      REAL CHECK (confidence_score BETWEEN 0 AND 1),
  latency_ms            INTEGER,
  cost_usd              REAL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rlm_response_log_contact_idx ON rlm_response_log(contact_id);
CREATE INDEX IF NOT EXISTS rlm_response_log_created_idx ON rlm_response_log(created_at DESC);
CREATE INDEX IF NOT EXISTS rlm_response_log_sent_idx ON rlm_response_log(was_sent)
  WHERE was_sent = true;

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- All tables use service role only (no anon access).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE rlm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_style_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_cadence_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_draft_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_response_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (RLM operates exclusively via service key)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'rlm_contacts', 'rlm_style_profiles', 'rlm_messages',
    'rlm_attachments', 'rlm_cadence_patterns',
    'rlm_draft_replies', 'rlm_response_log'
  ])
  LOOP
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "service_role_all" ON %I FOR ALL USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGER
-- Auto-update updated_at on contacts and style_profiles.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rlm_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rlm_contacts_updated_at
  BEFORE UPDATE ON rlm_contacts
  FOR EACH ROW EXECUTE FUNCTION rlm_set_updated_at();

CREATE TRIGGER rlm_style_profiles_updated_at
  BEFORE UPDATE ON rlm_style_profiles
  FOR EACH ROW EXECUTE FUNCTION rlm_set_updated_at();
