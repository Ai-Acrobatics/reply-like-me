# Reply Like Me — Unified MCP Tool Architecture

**PERS-391** | Date: 2026-04-04 | Status: Implemented

## Overview

A single MCP server (`reply-like-me`) that provides unified access to Julian's communication data across four backends. Any fleet agent can query contacts, search messages semantically, retrieve style profiles, and log response feedback — all through one MCP interface.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Fleet Agents                          │
│  (Claude Code sessions, Telegram bot, response engine)  │
└────────────────────────┬────────────────────────────────┘
                         │ MCP (stdio)
┌────────────────────────▼────────────────────────────────┐
│              reply-like-me MCP Server                    │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │contact_lookup │  │search_messages│  │search_images │  │
│  │list_contacts  │  │get_context    │  │log_response  │  │
│  │get_style_prof │  │               │  │              │  │
│  └──────┬───────┘  └───────┬───────┘  └──────┬───────┘  │
│         │                  │                  │          │
│  ┌──────▼──────────────────▼──────────────────▼───────┐  │
│  │              Routing Layer (per tool)               │  │
│  └──┬──────────┬────────────┬──────────────┬──────────┘  │
│     │          │            │              │             │
│  ┌──▼───┐  ┌──▼─────┐  ┌──▼────────┐  ┌──▼──────────┐  │
│  │Supa- │  │Pine-   │  │Obsidian   │  │Notion       │  │
│  │base  │  │cone    │  │Vault      │  │(read-only)  │  │
│  │      │  │        │  │(fs read)  │  │(future)     │  │
│  └──────┘  └────────┘  └───────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Data Flow Per Backend

### Supabase (Primary — Structured Data)
- **Tables:** `rlm_contacts`, `rlm_style_profiles`, `rlm_messages`, `rlm_attachments`, `rlm_cadence_patterns`, `rlm_response_log`
- **Access:** Service role key (bypasses RLS for server-side access)
- **Used by:** Every tool — contacts, profiles, messages, response logging

### Pinecone (Semantic Search)
- **Index:** `reply-like-me`
- **Namespaces:** `messages` (text embeddings), `images` (image embeddings)
- **Dimensions:** 768 (text, Matryoshka-reduced from 3072) / 3072 (images, full)
- **Used by:** `search_messages` (semantic mode), `search_images`
- **Embedding model:** Google text-embedding-004 (768d)

### Obsidian (Human Summaries)
- **Path:** `/opt/agency-workspace/obsidian-vault/Reply-Like-Me/Contacts/{Name}.md`
- **Fallbacks:** `People/{Name}.md`, `Contacts/{Name}.md`
- **Access:** Direct filesystem read (no API)
- **Used by:** `contact_lookup`, `get_style_profile`

### Notion (Future — Read-Only Meeting Context)
- **Purpose:** Pull meeting notes/transcripts relevant to a contact
- **Status:** Deferred — will add when reply engine needs meeting context
- **Access:** Will use `god notion search` or Notion MCP

## MCP Tools Reference

| Tool | Purpose | Backends Hit |
|------|---------|-------------|
| `contact_lookup` | Find contact by phone/email/name, return profile + style + obsidian | Supabase + Obsidian |
| `search_messages` | Semantic or keyword search across 1.24M messages | Pinecone + Supabase |
| `get_conversation_context` | Last N messages + style profile for reply generation | Supabase |
| `get_style_profile` | Full style profile (formality, emoji, cadence, burst patterns) | Supabase + Obsidian |
| `search_images` | Semantic image search across iMessage attachments | Pinecone + Supabase |
| `log_response` | Log generated/sent/edited responses for feedback loop | Supabase |
| `list_contacts` | Browse contacts with filters (type, activity, sort) | Supabase |

## File Structure

```
reply-like-me/
├── src/
│   ├── index.ts              # MCP server entry point + all 7 tools
│   ├── embeddings.ts         # Google text-embedding-004 wrapper
│   └── clients/
│       ├── supabase.ts       # Supabase client factory
│       ├── pinecone.ts       # Pinecone client factory
│       └── obsidian.ts       # Obsidian vault filesystem reader
├── scripts/
│   └── generate-embeddings.ts  # (planned) Batch embedding script
├── .env                      # Supabase, Pinecone, Google API keys
├── package.json              # MCP SDK + Supabase + Pinecone + Gemini deps
├── tsconfig.json             # ES2022, strict, bundler resolution
├── RESEARCH.md               # Full research document (data architecture, scraping, profiling)
├── ARCHITECTURE.md           # This file
└── .planning/
    └── PROJECT.md            # Project requirements and roadmap
```

## Registration in Fleet

Add to any agent's `.mcp.json`:

```json
{
  "mcpServers": {
    "reply-like-me": {
      "command": "node",
      "args": ["/opt/agency-workspace/reply-like-me/dist/src/index.js"],
      "env": {
        "SUPABASE_URL": "https://jrirksdiklqwsaatbhvg.supabase.co",
        "SUPABASE_SERVICE_KEY": "<service-key>",
        "GOOGLE_API_KEY": "<google-api-key>",
        "PINECONE_API_KEY": "<pinecone-api-key>",
        "PINECONE_INDEX": "reply-like-me"
      }
    }
  }
}
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single MCP server (not per-backend) | Simpler registration, cross-backend queries in one tool call |
| Supabase as primary store | Existing fleet project, SQL for structured queries, pgvector for future |
| Pinecone for semantic search | Pre-configured, serverless, supports multimodal (text+image) |
| Obsidian via filesystem (not API) | Vault is local on VPS, no overhead, human-editable |
| Notion deferred | Not needed for v1 reply generation; add when meeting context required |
| text-embedding-004 (768d) | Cheaper than gemini-embedding-2 (3072d), sufficient for text search |
| All tools return JSON | Consistent parsing by consuming agents, easy to extract fields |
| Response log tool included | Enables feedback loop from day 1 — track accept/edit/reject rates |

## Dependencies

```
@modelcontextprotocol/sdk ^1.12.1  — MCP server framework
@supabase/supabase-js     ^2.49.0  — Supabase client
@pinecone-database/pinecone ^4.1.0 — Pinecone client
@google/generative-ai     ^0.24.0  — Google embedding API
zod                        ^3.24.0  — Schema validation for tool params
dotenv                     ^16.5.0  — Environment variable loading
```

## Next Steps (Post-Architecture)

1. **Create Supabase tables** — Run the SQL from RESEARCH.md to create `rlm_*` tables
2. **Deploy scraper on Mac Mini** — `scrape_messages.py` with 5-minute cron
3. **Initial backfill** — Ingest 1.24M messages into Supabase + embed into Pinecone
4. **Generate style profiles** — Batch analysis via Ollama for all contacts
5. **Register MCP server** — Add to fleet agents' `.mcp.json`
6. **Build response engine** — Consumes this MCP tool to generate Julian-like replies
