-- Message classifications table
-- Stores NLP classification results from Ollama for each message
CREATE TABLE IF NOT EXISTS message_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  intent TEXT NOT NULL CHECK (intent IN (
    'question', 'statement', 'request', 'greeting', 'farewell',
    'humor', 'emotional', 'informational', 'logistics', 'acknowledgment'
  )),
  topic TEXT NOT NULL CHECK (topic IN (
    'business', 'personal', 'logistics', 'social', 'faith',
    'fitness', 'tech', 'finance', 'family', 'other'
  )),
  urgency TEXT NOT NULL CHECK (urgency IN ('high', 'medium', 'low')),
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  confidence REAL NOT NULL DEFAULT 0,
  raw_analysis TEXT,
  model_used TEXT NOT NULL DEFAULT 'llama3.1:70b',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_message_classification UNIQUE (message_id)
);

-- Index for joining back to messages
CREATE INDEX IF NOT EXISTS idx_classifications_message_id
  ON message_classifications(message_id);

-- Index for filtering by topic/intent
CREATE INDEX IF NOT EXISTS idx_classifications_topic
  ON message_classifications(topic);

CREATE INDEX IF NOT EXISTS idx_classifications_intent
  ON message_classifications(intent);

-- Index for pipeline pagination
CREATE INDEX IF NOT EXISTS idx_classifications_processed_at
  ON message_classifications(processed_at DESC);
