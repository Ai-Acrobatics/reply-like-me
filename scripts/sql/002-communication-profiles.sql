-- Communication profiles table
-- Stores per-contact NLP profiles built from message analysis
CREATE TABLE IF NOT EXISTS communication_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  formality_score REAL NOT NULL DEFAULT 5 CHECK (formality_score BETWEEN 1 AND 10),
  avg_message_length REAL NOT NULL DEFAULT 0,
  avg_messages_per_turn REAL NOT NULL DEFAULT 1,
  emoji_frequency REAL NOT NULL DEFAULT 0,
  common_emojis JSONB NOT NULL DEFAULT '[]',
  greeting_patterns JSONB NOT NULL DEFAULT '[]',
  signoff_patterns JSONB NOT NULL DEFAULT '[]',
  slang_terms JSONB NOT NULL DEFAULT '[]',
  topic_distribution JSONB NOT NULL DEFAULT '{}',
  sentiment_baseline TEXT NOT NULL DEFAULT 'neutral'
    CHECK (sentiment_baseline IN ('positive', 'negative', 'neutral', 'mixed')),
  avg_response_delay_minutes REAL,
  active_hours JSONB NOT NULL DEFAULT '{"start": 8, "end": 21}',
  message_style TEXT NOT NULL DEFAULT 'moderate'
    CHECK (message_style IN ('terse', 'moderate', 'verbose')),
  uses_caps BOOLEAN NOT NULL DEFAULT FALSE,
  uses_punctuation BOOLEAN NOT NULL DEFAULT TRUE,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_contact_profile UNIQUE (contact_id)
);

-- Index for lookup by contact
CREATE INDEX IF NOT EXISTS idx_profiles_contact_id
  ON communication_profiles(contact_id);

-- Index for finding stale profiles
CREATE INDEX IF NOT EXISTS idx_profiles_last_analyzed
  ON communication_profiles(last_analyzed_at);
