# Reply Like Me

## What This Is

An AI-powered messaging agent that monitors Julian Bradley's iMessage conversations and auto-drafts replies that perfectly match his communication style per individual contact. The system builds per-contact communication profiles from historical message data, models his tone, cadence, emoji usage, and message length, then generates contextually appropriate replies using a cost-optimized LLM pipeline — all without sounding robotic.

## Core Value

Replies that feel like Julian wrote them — the right tone, the right length, the right vibe — for every contact, so Julian gets hours back while relationships stay authentic.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Phase 1 — Contact Foundation**
- [ ] Consolidate Google Workspace + iCloud contacts into unified Supabase `people` table
- [ ] Standardize all phone numbers to E.164 format (+1XXXXXXXXXX)
- [ ] Deduplicate contacts across sources (merge by phone/email)
- [ ] Auto-tag each contact with relationship type (client, friend, family, mentor, etc.)
- [ ] Auto-assign circle rank (inner, key, outer, dormant) based on conversation frequency
- [ ] Weekly hygiene cron to flag stale contacts (>90 days no contact)

**Phase 2 — Message Data Pipeline**
- [ ] Poll ~/Library/Messages/chat.db every 5 minutes via SSH to Mac Mini/MacBook Pro
- [ ] Extract messages per contact (text, timestamp, sender, thread handle)
- [ ] Process meaningful photos via Google multimodal embeddings (skip memes/GIFs)
- [ ] Store message metadata + embeddings in Supabase + Pinecone
- [ ] Detect new messages since last poll (incremental sync, not full re-process)
- [ ] Handle iMessage groups separately from 1:1 conversations

**Phase 3 — NLP Profiling Engine**
- [ ] Build per-contact communication profiles using Ollama (llama-3.3-70b, local, free)
- [ ] Profile attributes: formality (1-10), avg message length, emoji frequency + types, greeting/sign-off patterns, slang, topic distribution, sentiment baseline
- [ ] Build per-contact cadence model: typical response delay, message block count, text block length
- [ ] Store profiles in Supabase `communication_profiles` table
- [ ] Auto-refresh profiles as new messages arrive (rolling window, not full recompute)

**Phase 4 — Reply Generation Engine**
- [ ] Retrieve relevant context: recent conversation + contact profile + relationship data
- [ ] Generate draft reply using tiered LLM routing:
  - Inner circle / high-stakes → Claude Sonnet 4.6
  - Standard contacts → DeepSeek V4 or Haiku 4.5
  - Bulk/low-priority → Ollama local
- [ ] Apply cadence modeling: split into correct number of message bubbles, add timing delays
- [ ] Store draft replies for Julian's review before sending
- [ ] Track which drafts were accepted/edited/rejected to improve future generations

**Phase 5 — MCP Tool + Review Interface**
- [ ] Build unified MCP tool for cross-system queries (Supabase + Pinecone + Obsidian + Notion read-only)
- [ ] Simple review UI (or Telegram bot) to approve/edit/reject drafted replies
- [ ] One-click send via god mac send command
- [ ] Track acceptance rates per contact to tune LLM routing
- [ ] Expose MCP tool to other fleet agents for contact lookups

### Out of Scope

- **Fully autonomous sending (no review)** — too risky for relationships; Julian reviews all drafts v1
- **WhatsApp / Telegram parsing** — iMessage first; expand to other platforms in v2
- **Custom model fine-tuning** — prompt engineering + profile retrieval is sufficient; training costs not justified
- **Separate Obsidian vault** — use single shared vault at /opt/agency-workspace/obsidian-vault/ to preserve wikilinks
- **Real-time streaming** — 5-minute poll cadence is sufficient for messaging context
- **Voice messages** — text-only for v1; voice transcription deferred

## Context

- **Message source:** ~/Library/Messages/chat.db (SQLite) on Mac Mini (100.108.83.124) and MacBook Pro (100.89.189.37) — ~10 years of conversation history available
- **Existing infrastructure:** message-intelligence/ project has Supabase + Trigger.dev + Google OAuth + Pinecone already configured
- **Supabase project:** jrirksdiklqwsaatbhvg (Dashboard Daddy) — existing `people` table with contact schema
- **Ollama available:** llama-3.3-70b running locally on VPS (100.82.80.45:11434) — free inference
- **God CLI:** `god mac exec "command"` for SSH access, `god mac send` for iMessage sending
- **Google APIs:** OAuth configured for contacts, calendar, gmail, drive (available in message-intelligence/.env)
- **Known contacts:** ~10 seeded in fix-contacts.ts with communication profiles
- **Pinecone:** Configured with Google multimodal embeddings for image + text semantic search
- **Trigger.dev:** proj_uwuxpherghusguizvbvo — for scheduled jobs and background processing
- **Monthly cost target:** $0-2/month (Ollama for free, DeepSeek/Haiku for premium, minimal Pinecone reads)

## Constraints

- **Tech Stack**: Node.js/TypeScript — consistent with message-intelligence project and fleet tooling
- **Privacy**: All message processing stays local (Ollama) or within Julian's own API accounts — no third-party training
- **Access**: Mac Mini must be reachable via Tailscale (100.108.83.124) — SSH polling requires stable connection
- **Database**: Supabase project jrirksdiklqwsaatbhvg — no new Supabase project; extend existing schema
- **Cost**: LLM costs must stay under $5/month — default to Ollama, escalate only for high-value contacts
- **No sends without review**: v1 drafts only — Julian manually approves before any message is sent

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Blended data architecture (Supabase + Pinecone + Obsidian + Notion read-only) | Each system has its strength: Supabase for structured queries, Pinecone for semantic search, Obsidian for relationship knowledge, Notion for meeting context | — Pending |
| Single shared Obsidian vault | Prevents wikilink breakage; cross-project linking (contacts appear in multiple projects) | — Pending |
| Ollama first, cloud LLM as escalation | Keeps monthly cost near $0; sufficient for most contacts | — Pending |
| 5-minute poll cadence via SSH to chat.db | SQLite file polling is simpler than SQLite replication; Mac Mini always on | — Pending |
| Draft-and-review (not auto-send) for v1 | Protects relationships while system learns Julian's style | — Pending |
| Tiered LLM routing by contact circle | Inner circle deserves best model; most contacts fine with cheap/local | — Pending |

---
*Last updated: 2026-04-04 after initialization*
