# Reply Like Me — Architecture Research Document

**Date:** 2026-04-04
**Author:** Agent 3 (Research)
**Status:** Research Complete — Ready for Implementation Planning

---

## Executive Summary

Reply Like Me will scrape Julian's iMessage history (1.24M messages, 9 years, 15K contacts), build per-contact communication profiles, and generate responses matching his exact style. The system uses a tiered architecture: Supabase for structured data + metadata, Pinecone for semantic search + image vectors, and Obsidian for human-readable summaries. Cost target: under $15/month for 75-100 messages/day.

---

## 1. Data Architecture: Supabase + Pinecone + Obsidian Blend

### What Goes Where

| Layer | Store | Purpose | Access Pattern |
|-------|-------|---------|----------------|
| **Structured Data** | Supabase (PostgreSQL) | Messages, contacts, profiles, cadence stats, attachment metadata | SQL queries, joins, aggregations |
| **Semantic Search** | Pinecone | Message embeddings, image embeddings, conversation context vectors | Similarity search, RAG retrieval |
| **Human Summaries** | Obsidian vault | Per-contact relationship summaries, communication notes, style guides | Agent/human reference |

### Supabase Schema (Detailed)

```sql
-- Core tables in Supabase project jrirksdiklqwsaatbhvg

-- Contacts (enriched from handle table + Google Contacts)
CREATE TABLE rlm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle_id TEXT NOT NULL,           -- phone/email from chat.db
    display_name TEXT,                 -- resolved from Google Contacts
    phone TEXT,
    email TEXT,
    relationship_type TEXT,            -- 'family', 'friend', 'client', 'vendor', 'acquaintance'
    first_message_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    total_messages INT DEFAULT 0,
    total_from_julian INT DEFAULT 0,
    total_to_julian INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,    -- messaged in last 90 days
    google_contact_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Style profiles (one per contact)
CREATE TABLE rlm_style_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id),
    -- Formality & Tone
    formality_score FLOAT,             -- 1.0 (very casual) to 10.0 (very formal)
    sentiment_baseline FLOAT,          -- avg sentiment (-1.0 to 1.0)
    humor_frequency FLOAT,             -- 0.0 to 1.0
    sarcasm_frequency FLOAT,           -- 0.0 to 1.0
    -- Message Structure
    avg_message_length FLOAT,          -- chars per message
    avg_words_per_message FLOAT,
    messages_per_burst FLOAT,          -- avg msgs sent in rapid succession
    burst_threshold_seconds INT,       -- gap defining "same burst" (default 60)
    single_vs_multi_ratio FLOAT,       -- ratio of single-msg vs multi-msg responses
    -- Emoji & Expression
    emoji_frequency FLOAT,             -- emojis per message
    top_emojis JSONB,                  -- ['😂', '👍', '🔥', ...] top 10
    exclamation_frequency FLOAT,
    question_frequency FLOAT,
    caps_usage TEXT,                    -- 'never', 'emphasis_only', 'frequent'
    -- Greetings & Sign-offs
    greeting_patterns JSONB,           -- ['yo', 'hey', 'Hey man', null (no greeting)]
    signoff_patterns JSONB,            -- ['later', 'peace', null]
    -- Vocabulary
    abbreviation_frequency FLOAT,      -- 'u' vs 'you', 'ur' vs 'your'
    common_abbreviations JSONB,        -- {'u': 0.8, 'lol': 0.5, 'nah': 0.3}
    slang_terms JSONB,                 -- contact-specific slang
    topic_distribution JSONB,          -- {'business': 0.3, 'sports': 0.2, ...}
    -- Cadence
    avg_response_time_seconds FLOAT,   -- Julian's avg response time to this contact
    response_time_p50 FLOAT,
    response_time_p90 FLOAT,
    active_hours JSONB,                -- {hour: frequency} when Julian texts this person
    active_days JSONB,                 -- {day: frequency}
    -- Metadata
    sample_size INT,                   -- messages analyzed
    last_analyzed_at TIMESTAMPTZ,
    model_version TEXT,                -- version of analysis pipeline
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw messages (synced from chat.db)
CREATE TABLE rlm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_db_rowid BIGINT UNIQUE NOT NULL,  -- for dedup on sync
    contact_id UUID REFERENCES rlm_contacts(id),
    handle_id TEXT NOT NULL,
    is_from_julian BOOLEAN NOT NULL,
    text_content TEXT,
    date_utc TIMESTAMPTZ NOT NULL,
    date_read TIMESTAMPTZ,
    date_delivered TIMESTAMPTZ,
    is_group_chat BOOLEAN DEFAULT false,
    chat_guid TEXT,                     -- chat.db chat.guid
    has_attachment BOOLEAN DEFAULT false,
    attachment_types JSONB,             -- ['image/jpeg', 'video/quicktime']
    is_reaction BOOLEAN DEFAULT false,  -- tapback/reaction message
    reaction_type TEXT,                 -- 'loved', 'liked', 'laughed', etc.
    pinecone_vector_id TEXT,           -- reference to Pinecone vector
    embedding_model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rlm_messages_contact ON rlm_messages(contact_id, date_utc);
CREATE INDEX idx_rlm_messages_date ON rlm_messages(date_utc);
CREATE INDEX idx_rlm_messages_rowid ON rlm_messages(chat_db_rowid);

-- Attachments
CREATE TABLE rlm_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES rlm_messages(id),
    chat_db_attachment_rowid BIGINT,
    filename TEXT,
    mime_type TEXT,
    total_bytes BIGINT,
    is_meaningful BOOLEAN,             -- true = real photo, false = GIF/meme/sticker
    classification TEXT,               -- 'photo', 'screenshot', 'meme', 'gif', 'sticker', 'document', 'video', 'audio'
    classification_confidence FLOAT,
    local_path TEXT,                    -- path on Mac Mini
    pinecone_vector_id TEXT,           -- image embedding in Pinecone
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cadence model (per contact, per day-of-week, per hour)
CREATE TABLE rlm_cadence_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id),
    day_of_week INT,                   -- 0=Mon, 6=Sun
    hour_of_day INT,                   -- 0-23
    avg_response_delay_seconds FLOAT,
    median_response_delay_seconds FLOAT,
    message_probability FLOAT,         -- likelihood Julian texts at this time
    avg_burst_length FLOAT,            -- messages per conversation turn
    sample_count INT
);

-- Response log (for learning/feedback)
CREATE TABLE rlm_response_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES rlm_contacts(id),
    incoming_message TEXT,
    generated_response TEXT,
    model_used TEXT,                    -- 'ollama/llama3.1:70b', 'deepseek-v4', 'haiku-3.5'
    style_profile_version TEXT,
    was_sent BOOLEAN DEFAULT false,
    was_edited BOOLEAN DEFAULT false,
    edited_response TEXT,              -- Julian's correction (for fine-tuning)
    confidence_score FLOAT,
    latency_ms INT,
    cost_usd FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Pinecone Index Design

```
Index: reply-like-me
Dimension: 3072  (Gemini Embedding 2)
Metric: cosine
Cloud: aws / us-east-1 (serverless)

Namespace strategy:
  - "messages"     → text message embeddings
  - "images"       → image attachment embeddings
  - "conversations"→ conversation-level summary embeddings

Metadata per vector:
  - contact_id (string)
  - handle_id (string)
  - is_from_julian (bool)
  - date_utc (string ISO)
  - message_type ("text" | "image" | "conversation_summary")
  - supabase_id (string) → FK back to Supabase
```

### Obsidian Summaries

Path: `obsidian-vault/Reply-Like-Me/Contacts/{contact-name}.md`

```markdown
---
handle: +18585551234
name: Sean Gelt
relationship: client
formality: 7/10
last_updated: 2026-04-04
---

# Sean Gelt — Communication Profile

## Style Summary
Julian texts Sean in a professional-but-friendly tone. Uses proper grammar,
rarely abbreviates. Greeting: usually "Hey Sean" or no greeting (jumps straight
to business). Response time: typically 1-4 hours during business hours.

## Key Topics
- Hafnia Financial portal updates
- Compliance review requests
- Content approval workflows
- Meeting scheduling

## Patterns
- Sean often sends late evening (9-11pm) — Julian typically responds next morning
- Business-only — no personal topics
- Sean uses formal language; Julian mirrors with slight casualness
- No emoji from either side

## Sample Exchanges (representative)
[auto-generated excerpts showing typical back-and-forth]
```

### Data Flow & Sync Architecture

```
Mac Mini (chat.db)
    │
    ├─ Cron: every 5 minutes
    │  └─ scrape_messages.py
    │     ├─ Read new messages since last_rowid
    │     ├─ Decode attributedBody blobs
    │     ├─ Extract attachment metadata
    │     └─ POST to VPS API endpoint
    │
VPS (Processing Pipeline)
    │
    ├─ 1. Ingest → Supabase (rlm_messages, rlm_attachments)
    ├─ 2. Embed text → Gemini Embedding 2 → Pinecone "messages" namespace
    ├─ 3. Classify images → Gemini Embedding 2 → Pinecone "images" namespace
    ├─ 4. Update style profiles → Ollama (free, batch daily)
    ├─ 5. Update cadence patterns → Pure SQL aggregation
    └─ 6. Generate Obsidian summaries → Ollama (free, weekly)
```

### Avoiding Data Duplication

| Data | Single Source of Truth | Other Layers Reference Via |
|------|----------------------|---------------------------|
| Raw message text | Supabase `rlm_messages` | Pinecone metadata has `supabase_id` |
| Message embeddings | Pinecone | Supabase has `pinecone_vector_id` |
| Contact metadata | Supabase `rlm_contacts` | Obsidian has `handle` in frontmatter |
| Style profiles | Supabase `rlm_style_profiles` | Obsidian has human-readable summary |
| Image classifications | Supabase `rlm_attachments` | Pinecone has classification in metadata |

Rule: Never duplicate the actual content. Use cross-references (IDs) between layers.

---

## 2. Google Multimodal Embeddings for Image Filtering

### Gemini Embedding 2 — Key Specs

| Attribute | Value |
|-----------|-------|
| Model ID | `gemini-embedding-2-preview` |
| Dimensions | 3,072 (supports Matryoshka reduction to 768, 1024, etc.) |
| Max input tokens | 8,192 (text) |
| Modalities | Text, Image, Video, Audio, PDF |
| Vector space | Single unified space (text and images comparable) |
| MTEB English score | 68.32 (top by 5.09 points) |
| Pricing | $0.20 / 1M text tokens; images priced per-image |
| API | Gemini API or Vertex AI |

### Image Classification Strategy

Use Gemini Embedding 2 to classify every attachment image into meaningful vs noise:

```python
import google.generativeai as genai
from PIL import Image
import numpy as np

genai.configure(api_key=GEMINI_API_KEY)

# Embed reference categories (do this once, cache the vectors)
CATEGORY_TEXTS = {
    "meaningful_photo": "A personal photograph taken by someone, showing real people, places, events, selfies, scenery, food they cooked, their pets, their home",
    "screenshot": "A screenshot of a phone screen, computer screen, app interface, text conversation, website",
    "meme_gif": "An internet meme, reaction GIF, funny image macro, viral image with text overlay, cartoon reaction",
    "sticker": "A chat sticker, emoji sticker, animated sticker, bitmoji, memoji",
    "forwarded_content": "A forwarded image, shared social media post, news article image, advertisement, promotional content",
    "document": "A photo of a document, receipt, business card, form, contract, whiteboard, handwritten note",
}

# Pre-compute category embeddings
category_embeddings = {}
for cat, desc in CATEGORY_TEXTS.items():
    result = genai.embed_content(
        model="models/gemini-embedding-2-preview",
        content=desc,
        task_type="SEMANTIC_SIMILARITY"
    )
    category_embeddings[cat] = np.array(result['embedding'])

def classify_image(image_path: str) -> dict:
    """Classify an image as meaningful vs noise using multimodal embedding."""
    img = Image.open(image_path)

    # Get image embedding
    result = genai.embed_content(
        model="models/gemini-embedding-2-preview",
        content=img,
        task_type="SEMANTIC_SIMILARITY"
    )
    img_vec = np.array(result['embedding'])

    # Compare against category embeddings
    scores = {}
    for cat, cat_vec in category_embeddings.items():
        similarity = np.dot(img_vec, cat_vec) / (np.linalg.norm(img_vec) * np.linalg.norm(cat_vec))
        scores[cat] = float(similarity)

    best_category = max(scores, key=scores.get)
    is_meaningful = best_category in ("meaningful_photo", "screenshot", "document")

    return {
        "classification": best_category,
        "confidence": scores[best_category],
        "is_meaningful": is_meaningful,
        "all_scores": scores
    }
```

### Pinecone Multimodal Storage

Yes, Pinecone can store both text and image vectors in the same index -- **as long as they share the same dimensionality**. Gemini Embedding 2 outputs 3,072-dim vectors for both text and images in a unified space, so this works perfectly.

Use namespaces to separate concerns while sharing the index:
- `messages` namespace: text message embeddings (3,072-dim)
- `images` namespace: image attachment embeddings (3,072-dim)

Cross-modal search works: query with text "photo of Julian at the beach" and it will find relevant images, because both modalities share the same vector space.

### Image-Conversation Association

Store the `message_id` in Pinecone metadata so every image vector links back to:
1. The message it was attached to (Supabase `rlm_messages`)
2. The conversation context (preceding/following messages)
3. The contact who sent/received it

This enables queries like: "Show me photos Sean sent about the office" by combining semantic image search with contact filtering.

### Cost Estimate for Image Classification

Julian's chat.db has **131,240 attachments** total:
- 65,979 images (jpeg + heic + png + webp)
- 4,844 GIFs (auto-classify as not meaningful)
- 7,387 videos (classify separately if needed)

At Gemini Embedding 2 pricing:
- ~66K images to embed = roughly $0.50-2.00 total (one-time cost)
- Category text embeddings: negligible
- Ongoing: ~50-100 new images/week = < $0.01/week

---

## 3. Message Cadence Modeling

### What to Model

Human texting behavior follows distinct patterns that AI responses must replicate to appear natural. There are 5 key dimensions:

#### 3.1 Response Delay Distribution

Julian does NOT respond instantly to every message. His response times follow a **log-normal distribution** that varies by:
- Contact (responds faster to family than acquaintances)
- Time of day (faster during 9am-6pm, slower late night)
- Day of week (faster weekdays for business contacts)
- Message urgency (questions get faster responses than FYI messages)
- Conversation state (faster when actively chatting, slower for new threads)

**Implementation:**

```python
import numpy as np
from scipy import stats

def model_response_delay(contact_delays: list[float]) -> dict:
    """Fit a log-normal distribution to response delays for a contact."""
    delays = np.array([d for d in contact_delays if d > 0 and d < 86400])  # cap at 24h

    if len(delays) < 20:
        return {"model": "insufficient_data", "default_delay": 300}  # 5 min default

    # Fit log-normal distribution
    shape, loc, scale = stats.lognorm.fit(delays, floc=0)

    return {
        "model": "lognormal",
        "shape": shape,          # sigma of underlying normal
        "scale": scale,          # exp(mu) of underlying normal
        "p25": float(np.percentile(delays, 25)),
        "p50": float(np.percentile(delays, 50)),
        "p75": float(np.percentile(delays, 75)),
        "p90": float(np.percentile(delays, 90)),
        "mean": float(np.mean(delays)),
    }

def sample_response_delay(model_params: dict) -> float:
    """Sample a natural-looking response delay."""
    if model_params["model"] == "lognormal":
        delay = stats.lognorm.rvs(
            model_params["shape"],
            scale=model_params["scale"]
        )
        # Clamp between 30 seconds and 4 hours
        return max(30, min(delay, 14400))
    return model_params.get("default_delay", 300)
```

#### 3.2 Message Burst Modeling

Julian often sends multiple messages in rapid succession instead of one long message. This is a critical authenticity signal.

**Pattern types:**
- **Single shot:** One complete message (typical for business contacts)
- **Stream of consciousness:** 2-5 short messages in < 60 seconds
- **Correction follow-up:** Message + immediate correction/addition
- **Link + context:** URL/photo followed by explanation

**Implementation approach:**

```python
def analyze_burst_patterns(messages: list[dict]) -> dict:
    """Analyze how Julian structures multi-message responses."""
    bursts = []
    current_burst = []

    for i, msg in enumerate(messages):
        if not msg['is_from_julian']:
            continue
        if current_burst and (msg['date'] - current_burst[-1]['date']).seconds < 120:
            current_burst.append(msg)
        else:
            if current_burst:
                bursts.append(current_burst)
            current_burst = [msg]

    if current_burst:
        bursts.append(current_burst)

    return {
        "total_bursts": len(bursts),
        "avg_messages_per_burst": np.mean([len(b) for b in bursts]),
        "burst_length_distribution": {
            1: sum(1 for b in bursts if len(b) == 1) / len(bursts),
            2: sum(1 for b in bursts if len(b) == 2) / len(bursts),
            3: sum(1 for b in bursts if len(b) == 3) / len(bursts),
            "4+": sum(1 for b in bursts if len(b) >= 4) / len(bursts),
        },
        "avg_chars_per_message_in_burst": np.mean([
            len(m['text']) for b in bursts for m in b if m.get('text')
        ]),
        "avg_delay_between_burst_messages": np.mean([
            (b[i+1]['date'] - b[i]['date']).seconds
            for b in bursts if len(b) > 1
            for i in range(len(b)-1)
        ]),
    }
```

#### 3.3 Text Block Length Modeling

Per-contact modeling of how much Julian writes:

| Contact Type | Typical Msg Length | Burst Size |
|-------------|-------------------|------------|
| Close friends | 5-30 chars | 2-4 msgs |
| Family | 10-50 chars | 1-3 msgs |
| Clients (casual) | 20-80 chars | 1-2 msgs |
| Clients (formal) | 50-200 chars | 1 msg |
| New contacts | 30-100 chars | 1 msg |

#### 3.4 Making Responses Look Natural

Anti-detection signals to implement:

1. **Variable typing speed simulation:** Don't respond in 0.1 seconds. Calculate a realistic typing delay based on response length (avg 40 WPM texting speed + reading time for incoming message).

2. **Read receipt timing:** If read receipts are on, mark as "read" before responding, with a realistic gap between read and response.

3. **Imperfect spelling/grammar:** If Julian commonly types "ur" or "nah" with a contact, the AI must do the same. Perfect grammar with a casual contact is a dead giveaway.

4. **Time-appropriate responses:** Don't respond at 3am if Julian's pattern shows he never texts that contact between midnight and 7am.

5. **Conversation ending patterns:** Know when Julian typically stops responding (short acknowledgments like "bet", "word", "aight" signal conversation end).

#### 3.5 Cadence Engine Architecture

```
Incoming message → Cadence Engine
    │
    ├─ 1. Look up contact's cadence profile
    ├─ 2. Check current time vs contact's active hours
    ├─ 3. Sample response delay from log-normal model
    ├─ 4. Determine burst count (1-N messages)
    ├─ 5. Calculate inter-burst delays (5-30 seconds)
    ├─ 6. Schedule response(s) with realistic timing
    │
    └─ Output: [(message_text, send_at_timestamp), ...]
```

---

## 4. iMessage Scraping from macOS

### Julian's Actual Database Stats

| Metric | Value |
|--------|-------|
| **Database size** | 2.4 GB |
| **Total messages** | 1,244,335 |
| **Contacts (handles)** | 15,316 |
| **Chats** | 12,347 |
| **Attachments** | 131,240 |
| **Date range** | 2017-04-19 to 2026-04-04 (9 years) |
| **Messages with `text` field** | 7,965 (0.6%) |
| **Messages with `attributedBody` only** | 1,220,065 (99.4%) |
| **Location** | `/Users/thewizzard/Library/Messages/chat.db` |

### Attachment Breakdown

| Type | Count |
|------|-------|
| image/jpeg | 39,445 |
| image/heic | 16,498 |
| image/png | 10,036 |
| video/quicktime | 7,387 |
| image/gif | 4,844 |
| application/pdf | 2,491 |
| audio/amr | 1,728 |
| text/x-vlocation | 1,178 |
| text/vcard | 1,092 |
| Other | ~4,541 |

### Top Contacts by Message Volume

| Handle | Messages |
|--------|----------|
| +12679873310 | 33,680 |
| +12674744712 | 22,525 |
| +12153419521 | 16,728 |
| +17173240045 | 13,527 |
| +19498649943 | 10,350 |
| +16196132405 | 9,608 |
| +18622469774 | 9,046 |
| +14847675704 | 7,958 |
| +19852318376 | 7,427 |
| +19258088807 | 6,485 |

### Database Schema (Verified from Julian's Mac Mini)

#### `message` table (58 columns)

Key columns:
```
ROWID          INTEGER  PK      -- auto-increment ID
guid           TEXT     NOT NULL -- unique message identifier
text           TEXT              -- plain text (only 0.6% populated!)
attributedBody BLOB             -- NSAttributedString (99.4% of messages)
handle_id      INTEGER          -- FK to handle.ROWID
is_from_me     INTEGER          -- 0=received, 1=sent
date           INTEGER          -- nanoseconds since 2001-01-01 00:00:00 UTC
date_read      INTEGER          -- when message was read
date_delivered INTEGER          -- when message was delivered
is_read        INTEGER          -- read receipt
is_sent        INTEGER          -- delivery confirmation
cache_has_attachments INTEGER   -- quick check for attachments
associated_message_type INTEGER -- reaction type (2000-2005 = tapbacks)
is_audio_message INTEGER        -- voice message flag
```

#### `handle` table
```
ROWID               INTEGER PK
id                  TEXT    NOT NULL  -- phone number or email
country             TEXT
service             TEXT    NOT NULL  -- 'iMessage' or 'SMS'
person_centric_id   TEXT              -- Apple ID linkage
```

#### `chat` table
```
ROWID              INTEGER PK
guid               TEXT    NOT NULL
chat_identifier    TEXT              -- phone/email or group ID
display_name       TEXT              -- group chat name
style              INTEGER           -- 43=1-on-1, 45=group
```

#### `attachment` table
```
ROWID          INTEGER PK
guid           TEXT    NOT NULL
filename       TEXT              -- ~/Library/Messages/Attachments/...
mime_type      TEXT              -- 'image/jpeg', 'video/quicktime', etc.
total_bytes    INTEGER
is_outgoing    INTEGER
is_sticker     INTEGER           -- useful for filtering!
transfer_state INTEGER           -- 5=complete, others=incomplete
created_date   INTEGER
```

#### Join tables
```
chat_handle_join:     chat_id → handle_id
chat_message_join:    chat_id → message_id, message_date
message_attachment_join: message_id → attachment_id
```

### Date Conversion

Apple stores dates as **nanoseconds since 2001-01-01 00:00:00 UTC**:

```sql
-- Convert Apple nanosecond timestamp to UTC datetime
datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch') as date_utc

-- Convert to Unix timestamp for application use
(date/1000000000 + 978307200) as unix_timestamp
```

### attributedBody Decoding

**Critical:** 99.4% of Julian's messages have text ONLY in the `attributedBody` BLOB, not in the `text` column. This is standard behavior since macOS Ventura (2022).

The blob is a serialized `NSAttributedString` in Apple's `NSKeyedArchiver` format. Decoding approach:

```python
import re

def decode_attributed_body(blob: bytes) -> str | None:
    """
    Extract plain text from NSAttributedString blob.
    Handles the format used since macOS Ventura (2022+).
    """
    if not blob:
        return None

    try:
        # The text is stored after the NSString marker
        if b'NSString' not in blob:
            return None

        parts = blob.split(b'NSString')
        if len(parts) < 2:
            return None

        raw = parts[1]

        # Skip 5 header bytes after NSString marker
        text_bytes = raw[5:]

        # Find the end of text (before next object marker)
        end_markers = [b'NSDictionary', b'NSMutableString', b'NSArray']
        min_end = len(text_bytes)
        for marker in end_markers:
            idx = text_bytes.find(marker)
            if 0 < idx < min_end:
                min_end = idx

        text_bytes = text_bytes[:min_end]
        decoded = text_bytes.decode('utf-8', errors='ignore')

        # Remove non-printable characters, keep newlines/tabs
        cleaned = re.sub(r'[^\x20-\x7E\n\t\u00A0-\uFFFF]', '', decoded).strip()

        return cleaned if cleaned else None

    except Exception:
        return None


def get_message_text(text_field: str | None, attributed_body: bytes | None) -> str | None:
    """Get message text, trying text column first, then attributedBody."""
    if text_field and text_field.strip():
        return text_field.strip()
    return decode_attributed_body(attributed_body)
```

### Complete Scraping Script

```python
#!/usr/bin/env python3
"""
reply-like-me/scraper/scrape_messages.py

Continuous iMessage scraper for Reply Like Me.
Runs on Mac Mini via cron every 5 minutes.
Syncs new messages to VPS API endpoint.
"""

import sqlite3
import json
import os
import re
import time
import requests
from datetime import datetime, timezone
from pathlib import Path

# Configuration
CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")
STATE_FILE = os.path.expanduser("~/.reply-like-me-state.json")
VPS_API = "http://your-vps-ip:3100/api/rlm/ingest"
API_KEY = os.environ.get("RLM_API_KEY", "")
BATCH_SIZE = 500

def load_state() -> dict:
    """Load last sync state."""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"last_message_rowid": 0, "last_attachment_rowid": 0}

def save_state(state: dict):
    """Persist sync state."""
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)

def decode_attributed_body(blob: bytes) -> str | None:
    """Extract plain text from NSAttributedString blob."""
    if not blob:
        return None
    try:
        if b'NSString' not in blob:
            return None
        parts = blob.split(b'NSString')
        if len(parts) < 2:
            return None
        raw = parts[1]
        text_bytes = raw[5:]
        end_markers = [b'NSDictionary', b'NSMutableString', b'NSArray']
        min_end = len(text_bytes)
        for marker in end_markers:
            idx = text_bytes.find(marker)
            if 0 < idx < min_end:
                min_end = idx
        text_bytes = text_bytes[:min_end]
        decoded = text_bytes.decode('utf-8', errors='ignore')
        cleaned = re.sub(r'[^\x20-\x7E\n\t\u00A0-\uFFFF]', '', decoded).strip()
        return cleaned if cleaned else None
    except Exception:
        return None

def apple_ts_to_iso(nanoseconds: int) -> str | None:
    """Convert Apple nanosecond timestamp to ISO 8601 UTC string."""
    if not nanoseconds or nanoseconds <= 0:
        return None
    unix_ts = nanoseconds / 1_000_000_000 + 978307200  # 2001-01-01 epoch offset
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat()

def scrape_new_messages(conn: sqlite3.Connection, last_rowid: int) -> list[dict]:
    """Fetch all messages newer than last_rowid."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.attributedBody,
            m.handle_id,
            m.is_from_me,
            m.date,
            m.date_read,
            m.date_delivered,
            m.is_read,
            m.is_sent,
            m.cache_has_attachments,
            m.associated_message_type,
            m.associated_message_guid,
            m.is_audio_message,
            h.id as handle_identifier,
            h.service,
            c.guid as chat_guid,
            c.style as chat_style,
            c.display_name as chat_display_name
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ?
        ORDER BY m.ROWID ASC
        LIMIT ?
    """, (last_rowid, BATCH_SIZE))

    messages = []
    for row in cursor.fetchall():
        (rowid, guid, text, attr_body, handle_id, is_from_me, date,
         date_read, date_delivered, is_read, is_sent, has_attachments,
         assoc_type, assoc_guid, is_audio, handle_ident, service,
         chat_guid, chat_style, chat_name) = row

        # Decode text
        msg_text = text if text and text.strip() else decode_attributed_body(attr_body)

        # Detect reactions/tapbacks (associated_message_type 2000-2005)
        is_reaction = assoc_type is not None and 2000 <= assoc_type <= 2005
        reaction_map = {2000: "loved", 2001: "liked", 2002: "disliked",
                       2003: "laughed", 2004: "emphasized", 2005: "questioned"}

        messages.append({
            "rowid": rowid,
            "guid": guid,
            "text": msg_text,
            "handle_id": handle_ident,
            "service": service,
            "is_from_julian": bool(is_from_me),
            "date_utc": apple_ts_to_iso(date),
            "date_read": apple_ts_to_iso(date_read),
            "date_delivered": apple_ts_to_iso(date_delivered),
            "has_attachment": bool(has_attachments),
            "is_reaction": is_reaction,
            "reaction_type": reaction_map.get(assoc_type),
            "is_audio_message": bool(is_audio),
            "is_group_chat": chat_style == 45,
            "chat_guid": chat_guid,
            "chat_name": chat_name,
        })

    return messages

def scrape_new_attachments(conn: sqlite3.Connection, last_rowid: int) -> list[dict]:
    """Fetch attachment metadata for new messages."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            a.ROWID,
            a.guid,
            a.filename,
            a.mime_type,
            a.total_bytes,
            a.is_outgoing,
            a.is_sticker,
            a.transfer_state,
            a.created_date,
            maj.message_id
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        WHERE a.ROWID > ?
        ORDER BY a.ROWID ASC
        LIMIT ?
    """, (last_rowid, BATCH_SIZE))

    attachments = []
    for row in cursor.fetchall():
        (rowid, guid, filename, mime_type, total_bytes, is_outgoing,
         is_sticker, transfer_state, created_date, message_id) = row

        # Quick pre-classification based on metadata
        if is_sticker:
            classification = "sticker"
            is_meaningful = False
        elif mime_type and 'gif' in mime_type:
            classification = "gif"
            is_meaningful = False
        elif mime_type and mime_type.startswith('image/'):
            classification = "image_pending"  # needs Gemini classification
            is_meaningful = None  # TBD
        elif mime_type and mime_type.startswith('video/'):
            classification = "video"
            is_meaningful = None
        elif mime_type and mime_type.startswith('audio/'):
            classification = "audio"
            is_meaningful = True
        else:
            classification = "document"
            is_meaningful = True

        attachments.append({
            "rowid": rowid,
            "guid": guid,
            "filename": filename,
            "mime_type": mime_type,
            "total_bytes": total_bytes,
            "is_outgoing": bool(is_outgoing),
            "is_sticker": bool(is_sticker),
            "transfer_complete": transfer_state == 5,
            "classification": classification,
            "is_meaningful": is_meaningful,
            "message_rowid": message_id,
            "created_date": apple_ts_to_iso(created_date),
        })

    return attachments

def send_to_vps(messages: list, attachments: list) -> bool:
    """POST scraped data to VPS ingest API."""
    try:
        resp = requests.post(VPS_API, json={
            "messages": messages,
            "attachments": attachments,
            "scraped_at": datetime.now(tz=timezone.utc).isoformat(),
        }, headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        }, timeout=30)
        return resp.status_code == 200
    except Exception as e:
        print(f"Error sending to VPS: {e}")
        return False

def main():
    state = load_state()

    # Open read-only connection to chat.db
    conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)

    messages = scrape_new_messages(conn, state["last_message_rowid"])
    attachments = scrape_new_attachments(conn, state["last_attachment_rowid"])

    conn.close()

    if not messages and not attachments:
        return  # Nothing new

    print(f"Scraped {len(messages)} messages, {len(attachments)} attachments")

    if send_to_vps(messages, attachments):
        # Update state with highest ROWIDs
        if messages:
            state["last_message_rowid"] = max(m["rowid"] for m in messages)
        if attachments:
            state["last_attachment_rowid"] = max(a["rowid"] for a in attachments)
        state["last_sync"] = datetime.now(tz=timezone.utc).isoformat()
        save_state(state)
        print(f"Synced. New state: msg_rowid={state['last_message_rowid']}")
    else:
        print("Failed to send to VPS — will retry next cycle")

if __name__ == "__main__":
    main()
```

### Cron Setup (Mac Mini)

```bash
# Add to crontab on Mac Mini
# crontab -e
*/5 * * * * /usr/bin/python3 /Users/thewizzard/reply-like-me/scrape_messages.py >> /Users/thewizzard/reply-like-me/scraper.log 2>&1
```

### Privacy & Security Considerations

1. **Full Disk Access:** The Terminal/python3 process needs Full Disk Access in System Preferences > Privacy to read chat.db
2. **Read-only mode:** Always open chat.db with `?mode=ro` to prevent accidental writes
3. **WAL mode:** chat.db uses WAL journaling -- read-only access won't block iMessage writes
4. **Encryption at rest:** Messages in Supabase are behind RLS; Pinecone vectors cannot be reverse-engineered to original text
5. **API key auth:** All VPS endpoints require bearer token
6. **No cloud backup of chat.db:** Only metadata and text content leave the Mac, never the raw database file

---

## 5. Per-Contact Style Profiling

### Feature Extraction Pipeline

For each contact, extract the following features from Julian's messages TO that contact:

#### Tier 1: Statistical Features (Pure SQL/Python — Free)

| Feature | How to Extract | Storage |
|---------|---------------|---------|
| `formality_score` | Ratio of contractions, slang, proper grammar | FLOAT 1-10 |
| `avg_message_length` | `AVG(LENGTH(text))` | FLOAT |
| `avg_words_per_message` | Word count / message count | FLOAT |
| `messages_per_burst` | Group msgs < 120s apart, avg group size | FLOAT |
| `emoji_frequency` | Regex count emoji / total messages | FLOAT |
| `top_emojis` | Frequency-sorted emoji list | JSONB |
| `exclamation_frequency` | Count `!` / total messages | FLOAT |
| `question_frequency` | Count `?` / total messages | FLOAT |
| `caps_usage` | % messages with ALL CAPS words | TEXT enum |
| `abbreviation_frequency` | Match common abbrevs (u, ur, nah, lol) | FLOAT |
| `avg_response_time` | Diff between their msg and Julian's reply | FLOAT seconds |

#### Tier 2: Pattern Features (Ollama — Free)

Run locally with `llama3.1:70b` on VPS:

| Feature | Prompt Strategy |
|---------|----------------|
| `greeting_patterns` | "Analyze these 50 conversation starts from Julian. List his greeting patterns." |
| `signoff_patterns` | "Analyze how Julian ends conversations with this contact." |
| `humor_frequency` | "Rate 0-1 how often Julian uses humor in these messages." |
| `sarcasm_frequency` | "Rate 0-1 how often Julian is sarcastic." |
| `topic_distribution` | "Categorize these messages by topic: business, personal, sports, tech, ..." |
| `sentiment_baseline` | "What's the typical emotional tone Julian uses with this person?" |
| `common_abbreviations` | "List Julian's common abbreviations and slang with this contact." |

#### Tier 3: Deep Analysis (DeepSeek — Cheap)

For the top 50 contacts by message volume, run deeper analysis:

| Feature | Cost |
|---------|------|
| Full communication style summary (500 words) | ~$0.003 per contact |
| Relationship dynamics analysis | ~$0.005 per contact |
| Topic evolution over time | ~$0.005 per contact |

**Total cost for deep analysis of top 50:** ~$0.65

### Profile Generation Pipeline

```python
def generate_style_profile(contact_id: str, messages: list[dict]) -> dict:
    """
    Generate a comprehensive style profile for Julian's communication
    with a specific contact.
    """
    julian_msgs = [m for m in messages if m['is_from_julian']]
    their_msgs = [m for m in messages if not m['is_from_julian']]

    if len(julian_msgs) < 10:
        return {"status": "insufficient_data", "sample_size": len(julian_msgs)}

    # --- Tier 1: Statistical ---
    profile = {}

    # Message length
    lengths = [len(m['text']) for m in julian_msgs if m.get('text')]
    profile['avg_message_length'] = np.mean(lengths)
    profile['median_message_length'] = np.median(lengths)

    # Words per message
    word_counts = [len(m['text'].split()) for m in julian_msgs if m.get('text')]
    profile['avg_words_per_message'] = np.mean(word_counts)

    # Emoji analysis
    emoji_pattern = re.compile(
        "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0\U0001F900-\U0001F9FF"
        "\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
        "\U00002600-\U000026FF]+", flags=re.UNICODE
    )
    all_emojis = []
    msgs_with_emoji = 0
    for m in julian_msgs:
        if m.get('text'):
            found = emoji_pattern.findall(m['text'])
            if found:
                msgs_with_emoji += 1
                all_emojis.extend(found)

    profile['emoji_frequency'] = msgs_with_emoji / len(julian_msgs)
    emoji_counts = {}
    for e in all_emojis:
        emoji_counts[e] = emoji_counts.get(e, 0) + 1
    profile['top_emojis'] = sorted(emoji_counts, key=emoji_counts.get, reverse=True)[:10]

    # Abbreviation detection
    abbrevs = {'u': r'\bu\b', 'ur': r'\bur\b', 'lol': r'\blol\b',
               'nah': r'\bnah\b', 'ya': r'\bya\b', 'rn': r'\brn\b',
               'tbh': r'\btbh\b', 'ngl': r'\bngl\b', 'imo': r'\bimo\b'}
    abbrev_freq = {}
    for abbr, pattern in abbrevs.items():
        count = sum(1 for m in julian_msgs if m.get('text') and
                    re.search(pattern, m['text'], re.IGNORECASE))
        abbrev_freq[abbr] = count / len(julian_msgs)
    profile['abbreviation_frequency'] = sum(abbrev_freq.values()) / len(abbrevs)
    profile['common_abbreviations'] = {k: v for k, v in abbrev_freq.items() if v > 0.01}

    # Response time analysis
    response_times = []
    for i, msg in enumerate(messages):
        if msg['is_from_julian'] and i > 0 and not messages[i-1]['is_from_julian']:
            delta = (msg['date'] - messages[i-1]['date']).total_seconds()
            if 0 < delta < 86400:  # within 24 hours
                response_times.append(delta)

    if response_times:
        profile['avg_response_time_seconds'] = np.mean(response_times)
        profile['response_time_p50'] = np.percentile(response_times, 50)
        profile['response_time_p90'] = np.percentile(response_times, 90)

    # Burst analysis
    bursts = []
    current = []
    for m in julian_msgs:
        if current and (m['date'] - current[-1]['date']).total_seconds() < 120:
            current.append(m)
        else:
            if current:
                bursts.append(current)
            current = [m]
    if current:
        bursts.append(current)

    profile['messages_per_burst'] = np.mean([len(b) for b in bursts]) if bursts else 1.0
    profile['single_vs_multi_ratio'] = (
        sum(1 for b in bursts if len(b) == 1) / len(bursts) if bursts else 1.0
    )

    # Formality score (heuristic)
    formality_signals = {
        'contractions': sum(1 for m in julian_msgs if m.get('text') and
                          re.search(r"(don't|can't|won't|I'm|it's|that's)", m['text'])),
        'proper_punctuation': sum(1 for m in julian_msgs if m.get('text') and
                                  m['text'][-1:] in '.!?'),
        'capitalized_start': sum(1 for m in julian_msgs if m.get('text') and
                                 m['text'][0:1].isupper()),
        'no_slang': len(julian_msgs) - sum(
            1 for m in julian_msgs if m.get('text') and
            re.search(r'\b(lol|lmao|bruh|yo|nah|bet|fr|ngl)\b', m['text'], re.I)
        ),
    }
    # Normalize to 1-10 scale
    formal_ratio = (
        formality_signals['proper_punctuation'] / len(julian_msgs) * 0.3 +
        formality_signals['capitalized_start'] / len(julian_msgs) * 0.3 +
        formality_signals['no_slang'] / len(julian_msgs) * 0.4
    )
    profile['formality_score'] = round(formal_ratio * 10, 1)

    profile['sample_size'] = len(julian_msgs)

    return profile
```

### Formality Spectrum Examples

| Score | Style | Example |
|-------|-------|---------|
| 1-2 | Ultra casual | "yo", "lmao bet", "nah" |
| 3-4 | Casual | "hey whats up", "sounds good", "ya for sure" |
| 5-6 | Friendly | "Hey! Sounds good to me", "Sure thing" |
| 7-8 | Professional | "Hi Sean, I'll have that ready by EOD.", "Sounds great, thanks." |
| 9-10 | Formal | "Dear Mr. Gleisner, Please find attached..." |

---

## 6. Cost-Optimized Pipeline

### Model Tier Strategy

| Task | Model | Cost | Why |
|------|-------|------|-----|
| **Embedding text** | Gemini Embedding 2 | $0.20/1M tokens | Best multimodal, Pinecone-native |
| **Embedding images** | Gemini Embedding 2 | ~$0.002/image | Same unified space as text |
| **Style profiling** (batch) | Ollama llama3.1:70b | FREE | Running locally on VPS |
| **Obsidian summaries** | Ollama llama3.1:70b | FREE | Weekly batch, no latency requirement |
| **Response generation** (simple) | DeepSeek V3.2 | $0.28/1M in | Cheap, fast, good enough for casual |
| **Response generation** (important) | Claude Haiku 3.5 | $0.80/1M in | Higher quality for business contacts |
| **Response generation** (critical) | Claude Sonnet 4 | $3.00/1M in | Only for high-stakes messages |
| **Image classification** | Gemini Embedding 2 | ~$0.002/image | Cosine similarity vs category vectors |

### Daily Cost Breakdown (75-100 messages/day)

#### Steady-State Costs (Post Initial Ingestion)

| Component | Daily Volume | Cost/Day |
|-----------|-------------|----------|
| **New message embeddings** | ~150 msgs/day (sent + received) | ~$0.001 |
| **New image classification** | ~5 images/day | ~$0.01 |
| **Response generation (DeepSeek)** | ~80 responses × ~500 tokens avg | ~$0.012 |
| **Response generation (Haiku)** | ~15 responses × ~500 tokens | ~$0.006 |
| **Response generation (Sonnet)** | ~5 responses × ~500 tokens | ~$0.008 |
| **RAG context retrieval** | ~100 queries × ~2000 tokens | ~$0.04 |
| **Cadence model updates** | SQL aggregation | FREE |
| **Pinecone** | Free tier (< 2M vectors) | FREE |
| **Supabase** | Existing project | FREE (included) |
| **Ollama** | Style updates, summaries | FREE |
| **TOTAL** | | **~$0.08/day** |

#### Monthly: **~$2.40/month** steady state

#### One-Time Ingestion Costs

| Component | Volume | Cost |
|-----------|--------|------|
| Embed all 1.24M messages | ~1.24M msgs × ~50 tokens avg | $12.40 |
| Classify 66K images | 66K images | ~$1.50 |
| Generate 15K contact profiles | Via Ollama | FREE |
| Deep analysis top 50 contacts | Via DeepSeek | ~$0.65 |
| **TOTAL ONE-TIME** | | **~$14.55** |

### Escalation Logic

```python
def select_model(contact_id: str, message: str, context: dict) -> str:
    """Select the cheapest model that meets quality requirements."""
    contact = get_contact(contact_id)
    profile = get_style_profile(contact_id)

    # Tier 3: Sonnet — for high-stakes messages
    if contact.relationship_type == 'client' and context.get('is_business_critical'):
        return 'claude-sonnet-4'
    if 'money' in message.lower() or 'contract' in message.lower():
        return 'claude-sonnet-4'

    # Tier 2: Haiku — for business/professional contacts
    if profile.formality_score >= 7:
        return 'claude-haiku-3.5'
    if contact.relationship_type in ('client', 'vendor'):
        return 'claude-haiku-3.5'

    # Tier 1: DeepSeek — for casual/personal messages
    return 'deepseek-v3.2'
```

### Pinecone Cost at Scale

With 1.24M messages at 3,072 dimensions:
- Vector storage: ~1.24M × 3,072 × 4 bytes = ~15.2 GB
- **This exceeds the free tier** (2 GB) but fits Standard ($50/month)

**Optimization: Use Matryoshka dimension reduction.**

Gemini Embedding 2 supports Matryoshka Representation Learning. Reduce to 768 dimensions:
- Storage: ~1.24M × 768 × 4 bytes = ~3.8 GB
- Still exceeds free tier, but barely. Can use Standard at $50/mo.

**Alternative: Use Supabase pgvector instead of Pinecone.**

Supabase pgvector at 768 dimensions:
- 1.24M vectors × 768 dims = ~3.8 GB
- Well within Supabase's existing allocation
- **Cost: $0/month additional** (already on the project)
- Tradeoff: Slightly slower at scale, but 1.24M vectors is fine for pgvector

**Recommendation: Use Supabase pgvector for text message embeddings, Pinecone only for multimodal image vectors.** This keeps total cost under $5/month.

| Store | Content | Vectors | Dimensions |
|-------|---------|---------|------------|
| Supabase pgvector | Message text embeddings | ~1.24M | 768 (Matryoshka reduced) |
| Pinecone free tier | Image embeddings only | ~66K | 3,072 (full) |

66K image vectors at 3,072 dims = ~0.8 GB → fits Pinecone free tier.

---

## 7. Scraping Automation & Frequency

### Recommended: 5-Minute Polling with Change Detection

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Mac Mini   │────>│    VPS API   │────>│   Supabase   │
│  (scraper)   │ HTTP│  (ingest)    │ SQL │  + Pinecone  │
│  cron: */5   │     │  port 3100   │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Why 5 Minutes (Not Real-Time)

| Approach | Latency | Resource Use | Complexity | Recommendation |
|----------|---------|-------------|------------|----------------|
| **Real-time (fsevents)** | < 1 sec | High (constant monitoring) | High (need daemon) | Overkill |
| **1-minute poll** | 0-60 sec | Low | Low | Possible but aggressive |
| **5-minute poll** | 0-5 min | Minimal | Minimal | **Best balance** |
| **15-minute poll** | 0-15 min | Negligible | Minimal | Too slow for active convos |
| **Hourly batch** | 0-60 min | Negligible | Minimal | Only for initial backfill |

5 minutes is optimal because:
1. **Response cadence modeling shows** Julian rarely responds to casual messages in under 5 minutes anyway
2. **SQLite read is cheap:** Opening chat.db read-only and checking for new ROWIDs takes < 100ms
3. **No daemon overhead:** Cron is fire-and-forget, no memory leak risk
4. **Sufficient for training:** Style profiles update daily, not per-message

### Efficient Change Detection

```python
def has_new_messages(last_rowid: int) -> bool:
    """Ultra-fast check for new messages without full query."""
    conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
    cur = conn.cursor()
    cur.execute("SELECT MAX(ROWID) FROM message")
    max_rowid = cur.fetchone()[0]
    conn.close()
    return max_rowid > last_rowid
```

Alternatively, check file modification time first (even cheaper):

```python
import os

def chat_db_modified_since(last_check: float) -> bool:
    """Check if chat.db was modified since last check."""
    return os.path.getmtime(CHAT_DB) > last_check
```

### Resource Usage on Mac Mini

| Metric | Value |
|--------|-------|
| CPU per scrape | < 1% for 0.5 seconds |
| Memory | ~20 MB Python process (ephemeral) |
| Disk I/O | Read-only, ~1 MB per scrape |
| Network | ~50 KB per batch (JSON payload) |
| Impact on iMessage | Zero (read-only, WAL mode) |

### Initial Backfill Strategy

For the first-time ingestion of 1.24M messages:

```bash
# Run as a one-time job, not through cron
# Process in batches of 10,000 to avoid memory issues
python3 backfill.py --batch-size 10000 --start-rowid 0

# Estimated time: ~15 minutes for messages
# Embedding time: ~2-3 hours (API rate limits)
```

### Recommended Automation Schedule

| Task | Frequency | Where | Cost |
|------|-----------|-------|------|
| Message scraping | Every 5 min | Mac Mini cron | Free |
| Text embedding (new msgs) | Every 5 min (with scrape) | VPS | ~$0.001/day |
| Image classification | Every hour (batch new images) | VPS | ~$0.01/day |
| Style profile update | Daily at 3am UTC | VPS cron | Free (Ollama) |
| Cadence model update | Daily at 3am UTC | VPS (SQL) | Free |
| Obsidian summary refresh | Weekly (Sunday 3am) | VPS | Free (Ollama) |
| Contact resolution (Google) | Daily at 4am UTC | VPS | Free (gws CLI) |

---

## 8. System Architecture Overview

```
                    ┌─────────────────────────────┐
                    │         Mac Mini             │
                    │                              │
                    │  ~/Library/Messages/chat.db  │
                    │  (1.24M messages, 2.4 GB)    │
                    │                              │
                    │  Cron: */5 scrape_messages.py │
                    │  → POST /api/rlm/ingest      │
                    └──────────────┬───────────────┘
                                   │ HTTPS
                    ┌──────────────▼───────────────┐
                    │            VPS                │
                    │                              │
                    │  ┌─────────────────────────┐ │
                    │  │   Ingest API (:3100)     │ │
                    │  │   - Deduplicate          │ │
                    │  │   - Store in Supabase    │ │
                    │  │   - Queue for embedding  │ │
                    │  └────────────┬─────────────┘ │
                    │               │               │
                    │  ┌────────────▼─────────────┐ │
                    │  │   Processing Pipeline     │ │
                    │  │                           │ │
                    │  │   ┌─────────────────┐     │ │
                    │  │   │ Gemini Embed 2  │     │ │
                    │  │   │ (text + images) │     │ │
                    │  │   └────────┬────────┘     │ │
                    │  │            │               │ │
                    │  │   ┌────────▼────────┐     │ │
                    │  │   │ Supabase pgvec  │     │ │
                    │  │   │ (text vectors)  │     │ │
                    │  │   └─────────────────┘     │ │
                    │  │                           │ │
                    │  │   ┌─────────────────┐     │ │
                    │  │   │ Pinecone free   │     │ │
                    │  │   │ (image vectors) │     │ │
                    │  │   └─────────────────┘     │ │
                    │  │                           │ │
                    │  │   ┌─────────────────┐     │ │
                    │  │   │ Ollama 70b      │     │ │
                    │  │   │ (style profiles)│     │ │
                    │  │   └─────────────────┘     │ │
                    │  └──────────────────────────┘ │
                    │                              │
                    │  ┌──────────────────────────┐ │
                    │  │   Response Engine         │ │
                    │  │                           │ │
                    │  │   Incoming msg             │ │
                    │  │   → Identify contact       │ │
                    │  │   → Load style profile     │ │
                    │  │   → RAG: retrieve context  │ │
                    │  │   → Select model tier      │ │
                    │  │   → Generate response      │ │
                    │  │   → Cadence engine delay   │ │
                    │  │   → god mac send           │ │
                    │  └──────────────────────────┘ │
                    └──────────────────────────────┘
```

### Response Generation Prompt Template

```
You are Julian Bradley. You are responding to a message from {contact_name}.

## Your Style With This Person
{style_profile_summary}

## Key Rules
- Formality level: {formality_score}/10
- Average message length: {avg_message_length} characters
- Emoji usage: {emoji_frequency} (use these: {top_emojis})
- Greeting pattern: {greeting_patterns}
- Abbreviations: {common_abbreviations}
- Send as {burst_count} message(s)

## Recent Conversation Context
{last_20_messages}

## Similar Past Conversations (RAG)
{top_5_similar_conversations}

## Their Message
{incoming_message}

## Instructions
Reply EXACTLY as Julian would. Match his tone, length, style, and vocabulary
for this specific person. Do NOT be more formal or verbose than Julian normally is.
If Julian would send a one-word response, send a one-word response.

Return JSON:
{
  "messages": ["first message", "second message if burst"],
  "confidence": 0.0-1.0
}
```

---

## 9. Implementation Roadmap

### Phase 1: Data Ingestion (Week 1)
- [ ] Deploy scraper on Mac Mini
- [ ] Build VPS ingest API
- [ ] Backfill 1.24M messages into Supabase
- [ ] Set up pgvector extension in Supabase
- [ ] Embed all messages with Gemini Embedding 2

### Phase 2: Contact Profiling (Week 2)
- [ ] Resolve handles to names via Google Contacts (gws CLI)
- [ ] Generate statistical style profiles for all 15K contacts
- [ ] Deep-analyze top 50 contacts with Ollama
- [ ] Build cadence models per contact
- [ ] Generate Obsidian summaries

### Phase 3: Image Pipeline (Week 2-3)
- [ ] Classify 66K images with Gemini Embedding 2
- [ ] Index meaningful images in Pinecone
- [ ] Build image retrieval API

### Phase 4: Response Engine (Week 3-4)
- [ ] Build RAG retrieval pipeline (pgvector + context assembly)
- [ ] Implement model tier selection logic
- [ ] Build cadence engine (delay scheduling)
- [ ] Build burst message splitting
- [ ] Integration with `god mac send`

### Phase 5: Approval Loop (Week 4)
- [ ] Build Julian approval interface (Telegram bot or web UI)
- [ ] Queue generated responses for review
- [ ] Feedback loop: capture edits for fine-tuning
- [ ] Confidence threshold for auto-send vs require approval

### Phase 6: Auto-Pilot (Week 5+)
- [ ] Increase auto-send confidence threshold over time
- [ ] Monitor quality metrics
- [ ] Weekly style profile refresh
- [ ] Handle edge cases (new contacts, group chats, emotional messages)

---

## 10. Total Cost Summary

| Component | Monthly Cost |
|-----------|-------------|
| Supabase (existing project) | $0 |
| Pinecone (free tier, images only) | $0 |
| Gemini Embedding 2 (ongoing) | ~$0.50 |
| DeepSeek V3.2 (casual responses) | ~$0.40 |
| Claude Haiku 3.5 (business responses) | ~$0.20 |
| Claude Sonnet 4 (critical responses) | ~$0.25 |
| Ollama (style profiling, summaries) | $0 |
| Mac Mini (already running) | $0 |
| **TOTAL MONTHLY** | **~$1.35** |

| One-Time Cost | Amount |
|---------------|--------|
| Initial message embedding | ~$12.40 |
| Image classification | ~$1.50 |
| Deep contact analysis | ~$0.65 |
| **TOTAL ONE-TIME** | **~$14.55** |

**Grand total Year 1: ~$30.75**

---

*Research completed 2026-04-04. Ready for implementation planning.*
