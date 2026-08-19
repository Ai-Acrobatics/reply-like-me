-- Reply Like Me — Database Schema
-- Supabase project: jrirksdiklqwsaatbhvg (Dashboard Daddy)
-- Run with: psql $DATABASE_URL -f sql/001_schema.sql
-- Or paste into Supabase SQL Editor

-- ═══════════════════════════════════════════════════════════════
-- Enable required extensions
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector for text embeddings

-- ═══════════════════════════════════════════════════════════════
-- 1. Contacts (enriched from chat.db handle table + Google Contacts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle_id TEXT NOT NULL,
    display_name TEXT,
    phone TEXT,
    email TEXT,
    relationship_type TEXT CHECK (
        relationship_type IN ('family', 'friend', 'client', 'vendor', 'mentor', 'acquaintance', 'unknown')
    ),
    circle_rank TEXT CHECK (circle_rank IN ('inner', 'key', 'outer', 'dormant')),
    first_message_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    total_messages INT DEFAULT 0,
    total_from_julian INT DEFAULT 0,
    total_to_julian INT DEFAULT 0,
    message_count INT GENERATED ALWAYS AS (total_messages) STORED,
    is_active BOOLEAN DEFAULT true,
    google_contact_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rlm_contacts_handle ON rlm_contacts(handle_id);
CREATE INDEX IF NOT EXISTS idx_rlm_contacts_phone ON rlm_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_rlm_contacts_email ON rlm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_rlm_contacts_active ON rlm_contacts(is_active, total_messages DESC);

-- ═══════════════════════════════════════════════════════════════
-- 2. Communication / Style Profiles (one per contact)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_style_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id) ON DELETE CASCADE,
    -- Formality & Tone
    formality_score FLOAT,
    sentiment_baseline FLOAT,
    humor_frequency FLOAT,
    sarcasm_frequency FLOAT,
    -- Message Structure
    avg_message_length FLOAT,
    avg_words_per_message FLOAT,
    messages_per_burst FLOAT,
    burst_threshold_seconds INT DEFAULT 120,
    single_vs_multi_ratio FLOAT,
    -- Emoji & Expression
    emoji_frequency FLOAT,
    top_emojis JSONB DEFAULT '[]'::jsonb,
    exclamation_frequency FLOAT,
    question_frequency FLOAT,
    caps_usage TEXT CHECK (caps_usage IN ('never', 'emphasis_only', 'frequent')),
    -- Greetings & Sign-offs
    greeting_patterns JSONB DEFAULT '[]'::jsonb,
    signoff_patterns JSONB DEFAULT '[]'::jsonb,
    -- Vocabulary
    abbreviation_frequency FLOAT,
    common_abbreviations JSONB DEFAULT '{}'::jsonb,
    slang_terms JSONB DEFAULT '[]'::jsonb,
    topic_distribution JSONB DEFAULT '{}'::jsonb,
    -- Cadence (summary)
    avg_response_time_seconds FLOAT,
    response_time_p50 FLOAT,
    response_time_p90 FLOAT,
    active_hours JSONB DEFAULT '{}'::jsonb,
    active_days JSONB DEFAULT '{}'::jsonb,
    -- Reply generation helpers
    avg_bubbles_per_reply FLOAT DEFAULT 1.0,
    avg_chars_per_bubble FLOAT,
    avg_response_delay_minutes FLOAT,
    common_emojis JSONB DEFAULT '[]'::jsonb,
    sample_messages JSONB DEFAULT '[]'::jsonb,
    -- Metadata
    sample_size INT DEFAULT 0,
    last_analyzed_at TIMESTAMPTZ,
    model_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (contact_id)
);

-- Alias view for backward compatibility with "communication_profiles" name
CREATE OR REPLACE VIEW rlm_communication_profiles AS
SELECT * FROM rlm_style_profiles;

-- ═══════════════════════════════════════════════════════════════
-- 3. Raw Messages (synced from chat.db)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_db_rowid BIGINT UNIQUE NOT NULL,
    contact_id UUID REFERENCES rlm_contacts(id) ON DELETE CASCADE,
    handle_id TEXT NOT NULL,
    is_from_julian BOOLEAN NOT NULL,
    text_content TEXT,
    date_utc TIMESTAMPTZ NOT NULL,
    date_read TIMESTAMPTZ,
    date_delivered TIMESTAMPTZ,
    is_group_chat BOOLEAN DEFAULT false,
    chat_guid TEXT,
    has_attachment BOOLEAN DEFAULT false,
    attachment_types JSONB,
    is_reaction BOOLEAN DEFAULT false,
    reaction_type TEXT,
    -- Vector reference (points to pgvector or Pinecone)
    pinecone_vector_id TEXT,
    embedding_model TEXT,
    -- pgvector column for text embeddings (768-dim Matryoshka from Gemini)
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rlm_messages_contact ON rlm_messages(contact_id, date_utc DESC);
CREATE INDEX IF NOT EXISTS idx_rlm_messages_date ON rlm_messages(date_utc DESC);
CREATE INDEX IF NOT EXISTS idx_rlm_messages_rowid ON rlm_messages(chat_db_rowid);
CREATE INDEX IF NOT EXISTS idx_rlm_messages_text ON rlm_messages USING gin(to_tsvector('english', COALESCE(text_content, '')));

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_rlm_messages_embedding ON rlm_messages
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════════════════════════
-- 4. Attachments
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES rlm_messages(id) ON DELETE CASCADE,
    chat_db_attachment_rowid BIGINT,
    filename TEXT,
    mime_type TEXT,
    total_bytes BIGINT,
    is_meaningful BOOLEAN,
    classification TEXT CHECK (
        classification IN ('photo', 'screenshot', 'meme', 'gif', 'sticker', 'document', 'video', 'audio')
    ),
    classification_confidence FLOAT,
    local_path TEXT,
    pinecone_vector_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rlm_attachments_message ON rlm_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_rlm_attachments_meaningful ON rlm_attachments(is_meaningful) WHERE is_meaningful = true;

-- ═══════════════════════════════════════════════════════════════
-- 5. Cadence Patterns (per contact, per day/hour)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_cadence_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id) ON DELETE CASCADE,
    day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
    hour_of_day INT CHECK (hour_of_day BETWEEN 0 AND 23),
    avg_response_delay_seconds FLOAT,
    median_response_delay_seconds FLOAT,
    message_probability FLOAT,
    avg_burst_length FLOAT,
    sample_count INT,
    UNIQUE (contact_id, day_of_week, hour_of_day)
);

-- ═══════════════════════════════════════════════════════════════
-- 6. Response Log (feedback loop for quality improvement)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_response_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id) ON DELETE CASCADE,
    incoming_message TEXT,
    generated_response TEXT,
    model_used TEXT,
    style_profile_version TEXT,
    was_sent BOOLEAN DEFAULT false,
    was_edited BOOLEAN DEFAULT false,
    edited_response TEXT,
    confidence_score FLOAT,
    latency_ms INT,
    cost_usd FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rlm_response_log_contact ON rlm_response_log(contact_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 7. Draft Replies (for review workflow)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_draft_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id) ON DELETE CASCADE,
    contact_name TEXT,
    contact_phone TEXT,
    incoming_message TEXT NOT NULL,
    bubbles JSONB NOT NULL DEFAULT '[]'::jsonb,
    edited_bubbles JSONB,
    confidence FLOAT DEFAULT 0,
    llm_provider TEXT NOT NULL,
    llm_model TEXT NOT NULL,
    reasoning TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'edited', 'rejected', 'sent')),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rlm_drafts_status ON rlm_draft_replies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rlm_drafts_contact ON rlm_draft_replies(contact_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 8. Sync State (tracks scraper progress)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rlm_sync_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL UNIQUE,  -- 'mac-mini', 'macbook-pro'
    last_message_rowid BIGINT DEFAULT 0,
    last_attachment_rowid BIGINT DEFAULT 0,
    last_sync_at TIMESTAMPTZ,
    total_synced_messages BIGINT DEFAULT 0,
    total_synced_attachments BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 9. Updated-at trigger (auto-update updated_at column)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rlm_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_rlm_contacts_updated
    BEFORE UPDATE ON rlm_contacts
    FOR EACH ROW EXECUTE FUNCTION rlm_update_updated_at();

CREATE OR REPLACE TRIGGER trg_rlm_style_profiles_updated
    BEFORE UPDATE ON rlm_style_profiles
    FOR EACH ROW EXECUTE FUNCTION rlm_update_updated_at();

CREATE OR REPLACE TRIGGER trg_rlm_sync_state_updated
    BEFORE UPDATE ON rlm_sync_state
    FOR EACH ROW EXECUTE FUNCTION rlm_update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 10. Helper function: semantic search via pgvector
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rlm_search_messages(
    query_embedding vector(768),
    match_count INT DEFAULT 10,
    filter_contact_id UUID DEFAULT NULL,
    filter_from_julian BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    contact_id UUID,
    text_content TEXT,
    is_from_julian BOOLEAN,
    date_utc TIMESTAMPTZ,
    similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.contact_id,
        m.text_content,
        m.is_from_julian,
        m.date_utc,
        1 - (m.embedding <=> query_embedding) AS similarity
    FROM rlm_messages m
    WHERE m.embedding IS NOT NULL
        AND (filter_contact_id IS NULL OR m.contact_id = filter_contact_id)
        AND (filter_from_julian IS NULL OR m.is_from_julian = filter_from_julian)
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
