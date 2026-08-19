# Reply Like Me — Validation Report

**Linear:** AI-6862 · covers PERS-403, PERS-405, PERS-418, PERS-419, PERS-420

Validation pass over the reply generation engine, tiered LLM router, context
retrieval, cadence splitting, and MCP surface. Six defects were found; all six are
fixed and locked behind regression tests.

## Defects found

### D1 — engine and router disagreed on `generate()` (PERS-419, PERS-403)

`reply-engine.ts` called `router.generate(config, systemPrompt, userPrompt)` while
`LLMRouter.generate` accepted `(config, prompt)`. The router then recovered a user
prompt by splitting the single string on a `\n---USER MESSAGE---\n` sentinel that
nothing ever produced — so the inbound message would have been dropped and every
provider would have received an empty user turn.

**Fix:** `generate(config, systemPrompt, userPrompt)` takes both prompts as explicit
parameters and hands them to each provider directly. The sentinel-splitting is gone.

### D2 — `router.getTierForCircle()` did not exist (PERS-419)

`generateReply` called it when assembling its reasoning string. It was never defined
on `LLMRouter`, so every reply generation would have thrown `TypeError`.

**Fix:** added `getTierForCircle(circleRank): LLMTier`, backed by an explicit
`TIER_BY_CIRCLE` map. It reports the *policy* tier for a circle rank, which stays
meaningful when missing API keys force routing to degrade to Ollama.

### D3 — `selectModel` arity (PERS-419)

The interface declared `selectModel(circleRank, highStakes: boolean)` as two required
parameters; the engine calls it with one. **Fix:** `highStakes` is now optional.

### D4 — Pinecone filter never matched anything (PERS-418) — silent

`findSimilarMessages` filtered on `{ contact_id, is_from_me }`, but
`scripts/generate-embeddings.ts` upserts vectors with the metadata keys
`{ source, source_id, phone, direction, text, timestamp }`. The filter matched zero
vectors on every call. Because the lookup is wrapped in a `try/catch` that returns
`[]` on failure, this failed **silently** — semantic style retrieval, half of
PERS-418, was dead with no error surfaced.

**Fix:** filter on `phone` + `direction: "outbound"`. `buildContext` now resolves the
contact before the vector query (it needs the phone number), and short-circuits to
`[]` for contacts with no phone on file.

### D5 — the build could not see the engine

`tsconfig.json`'s `include` list omitted `src/llm-router.ts`, `src/reply-engine.ts`
and `src/supabase.ts`. `npm run build` reported success while D1–D3 sat in the tree
as hard compile errors, and `dist/` shipped without the engine.

**Fix:** all three files are in `include`; `tests` is excluded from the build.

### D6 — no tests existed

`package.json` declared `"test": "vitest run"` but the repo contained zero test files
and vitest was not installed.

**Fix:** 59 tests across three suites (below).

## Test suite

| Suite | Tests | Covers |
|---|---|---|
| `tests/llm-router.test.ts` | 19 | PERS-419 — circle-rank routing, high-stakes escalation, key-less degradation, provider request shapes, three-step fallback chain |
| `tests/reply-engine.test.ts` | 36 | PERS-403 / PERS-418 / PERS-420 — context assembly, Pinecone filter contract, prompt construction, cadence splitting, confidence scoring, end-to-end draft persistence, batch resilience |
| `tests/mcp-server.test.ts` | 4 | PERS-405 — boots the real stdio server in a child process and drives a JSON-RPC `initialize` + `tools/list` handshake, asserting all 9 tools and their schemas |

```bash
npm test        # 59 passed
npm run build   # tsc, exit 0
```

No network calls: the LLM router tests stub `fetch`, the engine tests mock the
embedder and Pinecone client, and the MCP test boots with throwaway credentials
(Supabase, Pinecone and Gemini clients are all constructed lazily).

## Mutation-checked

Each of the two silent defects was re-introduced to confirm the suite catches it:

| Reverted fix | Result |
|---|---|
| D4 Pinecone filter back to `{contact_id, is_from_me}` | 1 test fails |
| D1 user prompt dropped from the router call | 4 tests fail |

## Known gaps (not addressed here)

- `search_messages` (MCP tool 7) still filters on `contact_id` and reads
  `is_from_me` / `contact_name` from vector metadata. It has the same key mismatch as
  D4, but fixing it needs a product decision about whether that tool should search
  per-contact by phone or across the whole index. Worth its own issue.
- Live end-to-end generation against real Supabase/Pinecone/Anthropic credentials has
  not been exercised — everything above is verified against fakes.
- `src/profiler/**` remains excluded from the build and is untested.
