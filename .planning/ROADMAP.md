# Roadmap: Reply Like Me

## Overview

Five sequential phases build the complete messaging AI: first a clean contact foundation, then a live message ingestion pipeline, then per-contact NLP style profiles, then the reply generation engine with tiered LLM routing, and finally the MCP tool and review interface that ties everything together so Julian can approve and send AI-drafted replies in one click.

## Milestones

- 🚧 **v1.0 MVP** — Phases 1–5 (in progress)

## Phases

- [ ] **Phase 1: Contact Foundation** — Unified contact database with deduplication and relationship tagging
- [ ] **Phase 2: Message Pipeline** — Live message ingestion from chat.db with embedding storage
- [ ] **Phase 3: NLP Profiling** — Per-contact communication style and cadence profiles
- [ ] **Phase 4: Reply Generation** — Context-aware draft replies with tiered LLM routing
- [ ] **Phase 5: MCP + Review** — Unified query tool and Telegram review/send interface

---

## Phase Details

### Phase 1: Contact Foundation
**Goal**: Unified, deduplicated contact database with relationship metadata powering all downstream personalization
**Depends on**: Nothing (first phase)
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06
**Research needed**: Unlikely — Google Contacts API and iCloud sync are well-understood; fix-contacts.ts already seeded
**Success Criteria** (what must be TRUE):
  1. All Google Workspace and iCloud contacts are merged into Supabase `people` table with no duplicates
  2. Every contact has a valid E.164 phone number or is flagged as missing one
  3. Every contact has a relationship type (client/friend/family/etc.) and circle rank (inner/key/outer/dormant)
  4. A weekly hygiene cron runs and reports stale contacts (>90 days inactive)
**Plans**: 3 plans

Plans:
- [ ] 01-01: Supabase schema setup — `people` table with full contact + relationship fields
- [ ] 01-02: Google + iCloud contact sync + deduplication script
- [ ] 01-03: Relationship tagging, circle rank assignment, hygiene cron

---

### Phase 2: Message Pipeline
**Goal**: Continuous ingestion of Julian's iMessage conversations into Supabase + Pinecone with meaningful image classification
**Depends on**: Phase 1 (contacts must exist for message-to-contact linking)
**Requirements**: MSG-01, MSG-02, MSG-03, MSG-04, MSG-05, MSG-06
**Research needed**: Likely — chat.db schema needs verification; Google multimodal embeddings API has specific format requirements
**Research topics**:
  - chat.db schema: handle_id → phone mapping, message table columns, attachment blob format
  - Google multimodal embedding API: max input size, image format requirements, batch limits
  - Pinecone namespacing strategy for text vs image embeddings
**Success Criteria** (what must be TRUE):
  1. A cron job polls chat.db every 5 minutes and ingests new messages without duplicates
  2. All messages are linked to a contact in the `people` table via phone number
  3. Photos are classified (meaningful vs. meme/GIF/forward) and embedded via Google multimodal API
  4. Message text and image embeddings are stored and queryable in Pinecone
  5. Group messages are flagged separately from 1:1 threads
**Plans**: 4 plans

Plans:
- [ ] 02-01: chat.db connection + polling cron via SSH to Mac Mini
- [ ] 02-02: Incremental message extraction and Supabase metadata storage
- [ ] 02-03: Image classification pipeline with Google multimodal embeddings
- [ ] 02-04: Pinecone embedding storage for text + images (namespaced by contact)

---

### Phase 3: NLP Profiling
**Goal**: Per-contact communication style profiles and cadence models built from historical message data
**Depends on**: Phase 2 (messages must be in Supabase to analyze)
**Requirements**: NLP-01, NLP-02, NLP-03, NLP-04
**Research needed**: Likely — Ollama llama-3.3-70b prompt engineering for structured JSON output; optimal rolling window size
**Research topics**:
  - Ollama structured output: JSON mode availability in llama-3.3-70b
  - Rolling window strategy: how many messages per refresh cycle
  - Cadence math: standard deviation for response delay distribution
**Success Criteria** (what must be TRUE):
  1. Every active contact has a `communication_profiles` row with all style attributes populated
  2. Style profiles update automatically within 1 hour of new messages arriving
  3. Cadence model accurately captures Julian's typical message block size and response delay per contact
  4. Profile generation costs $0 (Ollama local only)
**Plans**: 3 plans

Plans:
- [ ] 03-01: `communication_profiles` schema + Ollama integration scaffold
- [ ] 03-02: Style attribute extraction pipeline (formality, emoji, length, patterns)
- [ ] 03-03: Cadence modeling + incremental profile refresh trigger

---

### Phase 4: Reply Generation
**Goal**: AI-drafted replies that match Julian's per-contact style, split into correct message bubbles, awaiting his review
**Depends on**: Phase 3 (profiles must exist to personalize generation)
**Requirements**: REPLY-01, REPLY-02, REPLY-03, REPLY-04, REPLY-05
**Research needed**: Likely — optimal context window assembly; DeepSeek API format; draft storage schema
**Research topics**:
  - Context assembly: how many recent messages + which profile fields to include in prompt
  - DeepSeek V4 API: endpoint, auth format, system prompt best practices
  - Draft schema: what metadata to store for feedback loop training
**Success Criteria** (what must be TRUE):
  1. When a new message arrives from a known contact, a draft reply is generated within 60 seconds
  2. Drafts for inner-circle contacts use Sonnet 4.6; standard contacts use DeepSeek/Haiku; low-priority use Ollama
  3. Generated reply is split into the correct number of bubbles matching the contact's cadence profile
  4. All drafts are stored in Supabase with status (pending/accepted/edited/rejected)
  5. Julian's edits and rejections are captured for future prompt improvement
**Plans**: 3 plans

Plans:
- [ ] 04-01: Context retrieval system (conversation history + profile + semantic similar messages)
- [ ] 04-02: Tiered LLM router + reply generation pipeline
- [ ] 04-03: Cadence-aware output splitting + draft storage + feedback tracking

---

### Phase 5: MCP + Review Interface
**Goal**: Unified MCP tool for fleet-wide contact queries and a Telegram bot for Julian to review, edit, and send draft replies
**Depends on**: Phase 4 (drafts must exist to review)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04
**Research needed**: Unlikely — MCP tool pattern established in fleet; Telegram bot API well-known; god mac send tested
**Success Criteria** (what must be TRUE):
  1. Any fleet agent can query the MCP tool to look up a contact's profile, circle rank, and conversation history
  2. New draft replies appear in Julian's Telegram bot within 60 seconds of generation
  3. Julian can approve, edit, or reject a draft with a single Telegram command
  4. Approved drafts send via iMessage through god mac send with no extra steps
  5. Acceptance rate dashboard shows per-contact and per-LLM-tier metrics
**Plans**: 3 plans

Plans:
- [ ] 05-01: Unified MCP tool (Supabase + Pinecone + Obsidian + Notion read-only)
- [ ] 05-02: Telegram review bot with approve/edit/reject commands
- [ ] 05-03: iMessage send integration + acceptance rate tracking dashboard

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contact Foundation | 0/3 | Not started | — |
| 2. Message Pipeline | 0/4 | Not started | — |
| 3. NLP Profiling | 0/3 | Not started | — |
| 4. Reply Generation | 0/3 | Not started | — |
| 5. MCP + Review | 0/3 | Not started | — |

**Total: 0/16 plans complete**
