-- Reply Like Me — Reply Engine Tables
-- Run against Supabase project jrirksdiklqwsaatbhvg
--
-- These tables support the reply generation engine (PERS-403):
--   - rlm_contacts: unified contact registry
--   - rlm_communication_profiles: per-contact style attributes
--   - rlm_messages: message history (synced from chat.db)
--   - rlm_draft_replies: generated drafts awaiting review
--

-- ── Contacts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rlm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle_id TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  email TEXT,
  relationship_type TEXT CHECK (relationship_type IN (
    'family', 'friend', 'client', 'vendor', 'mentor',
    'developer', 'community', 'acquaintance'
  )),
  circle_rank TEXT NOT NULL DEFAULT 'outer' CHECK (circle_rank IN (
    'inner', 'key', 'outer', 'dormant'
  )),
  last_message_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rlm_contacts_handle_idx ON rlm_contacts(handle_id);
CREATE INDEX IF NOT EXISTS rlm_contacts_phone_idx ON rlm_contacts(phone);
CREATE INDEX IF NOT EXISTS rlm_contacts_circle_idx ON rlm_contacts(circle_rank);

-- ── Communication Profiles ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS rlm_communication_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,
  formality SMALLINT NOT NULL DEFAULT 5 CHECK (formality BETWEEN 1 AND 10),
  avg_message_length INTEGER NOT NULL DEFAULT 0,
  emoji_frequency REAL NOT NULL DEFAULT 0 CHECK (emoji_frequency BETWEEN 0 AND 1),
  common_emojis JSONB NOT NULL DEFAULT '[]',
  greeting_patterns JSONB NOT NULL DEFAULT '[]',
  signoff_patterns JSONB NOT NULL DEFAULT '[]',
  slang_terms JSONB NOT NULL DEFAULT '[]',
  topic_distribution JSONB NOT NULL DEFAULT '{}',
  sentiment_baseline REAL NOT NULL DEFAULT 0 CHECK (sentiment_baseline BETWEEN -1 AND 1),
  avg_response_delay_minutes REAL NOT NULL DEFAULT 0,
  avg_bubbles_per_reply REAL NOT NULL DEFAULT 1,
  avg_chars_per_bubble REAL NOT NULL DEFAULT 100,
  sample_messages JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rlm_profiles_contact_idx
  ON rlm_communication_profiles(contact_id);

-- ── Messages ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rlm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,
  handle_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  is_from_me BOOLEAN NOT NULL DEFAULT false,
  timestamp TIMESTAMPTZ NOT NULL,
  thread_id TEXT,
  has_attachment BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rlm_messages_contact_idx ON rlm_messages(contact_id);
CREATE INDEX IF NOT EXISTS rlm_messages_timestamp_idx ON rlm_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS rlm_messages_contact_ts_idx
  ON rlm_messages(contact_id, timestamp DESC);

-- ── Draft Replies ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rlm_draft_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES rlm_contacts(id) ON DELETE CASCADE,
  contact_name TEXT,
  contact_phone TEXT,
  incoming_message TEXT NOT NULL,
  bubbles JSONB NOT NULL DEFAULT '[]',
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'edited', 'rejected', 'sent'
  )),
  edited_bubbles JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rlm_drafts_status_idx ON rlm_draft_replies(status);
CREATE INDEX IF NOT EXISTS rlm_drafts_contact_idx ON rlm_draft_replies(contact_id);
CREATE INDEX IF NOT EXISTS rlm_drafts_created_idx ON rlm_draft_replies(created_at DESC);

-- ── RLS Policies (service role bypasses, but good practice) ──────

ALTER TABLE rlm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_communication_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rlm_draft_replies ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY IF NOT EXISTS "service_role_all" ON rlm_contacts
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_role_all" ON rlm_communication_profiles
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_role_all" ON rlm_messages
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_role_all" ON rlm_draft_replies
  FOR ALL USING (true) WITH CHECK (true);
