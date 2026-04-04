# Requirements: Reply Like Me

## v1 Requirements

### CONT-01 — Contact Consolidation
Merge Google Workspace contacts and iCloud contacts into a single unified `people` table in Supabase.

**Category:** Contact Foundation
**Priority:** v1

---

### CONT-02 — Phone Number Normalization
Standardize all phone numbers to E.164 format (+1XXXXXXXXXX) across all contact sources.

**Category:** Contact Foundation
**Priority:** v1

---

### CONT-03 — Contact Deduplication
Detect and merge duplicate contacts across Google and iCloud sources, matching by phone and/or email.

**Category:** Contact Foundation
**Priority:** v1

---

### CONT-04 — Relationship Type Tagging
Auto-tag each contact with a relationship type: client (active/prospect/past), friend, family, mentor, discipleship, business owner, developer/team, event contact, community member.

**Category:** Contact Foundation
**Priority:** v1

---

### CONT-05 — Circle Rank Assignment
Auto-assign each contact a circle rank (inner, key, outer, dormant) based on conversation frequency and recency.

**Category:** Contact Foundation
**Priority:** v1

---

### CONT-06 — Contact Hygiene Cron
Weekly automated job to flag stale contacts (no interaction in >90 days) and clean up data quality issues.

**Category:** Contact Foundation
**Priority:** v1

---

### MSG-01 — chat.db Polling
Poll ~/Library/Messages/chat.db via SSH on Mac Mini (100.108.83.124) every 5 minutes to detect new messages.

**Category:** Message Pipeline
**Priority:** v1

---

### MSG-02 — Incremental Message Extraction
Extract only new messages since last poll (incremental sync), avoiding full re-processing of historical data.

**Category:** Message Pipeline
**Priority:** v1

---

### MSG-03 — Message Metadata Storage
Store message metadata (timestamp, contact handle, thread ID, is_from_me, message length) in Supabase.

**Category:** Message Pipeline
**Priority:** v1

---

### MSG-04 — Image Classification
Filter and classify meaningful photos from GIFs/memes/forwards using Google multimodal embeddings.

**Category:** Message Pipeline
**Priority:** v1

---

### MSG-05 — Semantic Embedding Storage
Store message text embeddings and image embeddings in Pinecone for semantic search.

**Category:** Message Pipeline
**Priority:** v1

---

### MSG-06 — Group vs 1:1 Handling
Detect and handle iMessage group conversations separately from 1:1 threads.

**Category:** Message Pipeline
**Priority:** v1

---

### NLP-01 — Communication Profile Schema
Define and create Supabase `communication_profiles` table to store per-contact style attributes.

**Category:** NLP Profiling
**Priority:** v1

---

### NLP-02 — Style Attribute Extraction
Build NLP pipeline using Ollama (llama-3.3-70b) to extract: formality (1-10), emoji frequency, avg message length, greeting/sign-off patterns, slang usage, topic distribution, sentiment baseline.

**Category:** NLP Profiling
**Priority:** v1

---

### NLP-03 — Cadence Modeling
Analyze per-contact patterns: typical response delay, message block count per reply, text block length per bubble.

**Category:** NLP Profiling
**Priority:** v1

---

### NLP-04 — Profile Auto-Refresh
Incrementally update communication profiles as new messages arrive (rolling window, not full recompute).

**Category:** NLP Profiling
**Priority:** v1

---

### REPLY-01 — Context Retrieval
Before generating a reply, retrieve: recent conversation history, contact's communication profile, relationship metadata, and semantically similar past messages.

**Category:** Reply Generation
**Priority:** v1

---

### REPLY-02 — Tiered LLM Routing
Route reply generation to the appropriate LLM based on contact's circle rank:
- Inner circle → Claude Sonnet 4.6
- Standard → DeepSeek V4 or Haiku 4.5
- Low priority → Ollama local

**Category:** Reply Generation
**Priority:** v1

---

### REPLY-03 — Cadence-Aware Output
Apply cadence modeling to split generated reply into correct number of message bubbles with appropriate length per bubble.

**Category:** Reply Generation
**Priority:** v1

---

### REPLY-04 — Draft Storage
Store generated draft replies with metadata (contact, thread, timestamp, LLM used, confidence) awaiting Julian's review.

**Category:** Reply Generation
**Priority:** v1

---

### REPLY-05 — Feedback Tracking
Track Julian's actions on drafts (accepted as-is / edited / rejected) to improve future generation quality.

**Category:** Reply Generation
**Priority:** v1

---

### MCP-01 — Unified Query MCP Tool
Build MCP tool that enables cross-system queries: Supabase (contacts + profiles), Pinecone (semantic search), Obsidian (relationship notes), Notion API read-only (meeting transcripts).

**Category:** MCP & Review
**Priority:** v1

---

### MCP-02 — Draft Review Interface
Build Telegram bot or simple UI to surface draft replies for Julian's approval, editing, or rejection.

**Category:** MCP & Review
**Priority:** v1

---

### MCP-03 — One-Click Send
Send approved replies via `god mac send` iMessage command from the review interface.

**Category:** MCP & Review
**Priority:** v1

---

### MCP-04 — Acceptance Rate Tracking
Track draft acceptance rates per contact and LLM tier; use to tune routing thresholds.

**Category:** MCP & Review
**Priority:** v1

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 1 | Pending |
| CONT-02 | Phase 1 | Pending |
| CONT-03 | Phase 1 | Pending |
| CONT-04 | Phase 1 | Pending |
| CONT-05 | Phase 1 | Pending |
| CONT-06 | Phase 1 | Pending |
| MSG-01 | Phase 2 | Pending |
| MSG-02 | Phase 2 | Pending |
| MSG-03 | Phase 2 | Pending |
| MSG-04 | Phase 2 | Pending |
| MSG-05 | Phase 2 | Pending |
| MSG-06 | Phase 2 | Pending |
| NLP-01 | Phase 3 | Pending |
| NLP-02 | Phase 3 | Pending |
| NLP-03 | Phase 3 | Pending |
| NLP-04 | Phase 3 | Pending |
| REPLY-01 | Phase 4 | Pending |
| REPLY-02 | Phase 4 | Pending |
| REPLY-03 | Phase 4 | Pending |
| REPLY-04 | Phase 4 | Pending |
| REPLY-05 | Phase 4 | Pending |
| MCP-01 | Phase 5 | Pending |
| MCP-02 | Phase 5 | Pending |
| MCP-03 | Phase 5 | Pending |
| MCP-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓
