# Graph Report - reply-like-me  (2026-09-16)

## Corpus Check
- Corpus is ~31,781 words - fits in a single context window. You may not need a graph.

## Summary
- 229 nodes · 377 edges · 17 communities (14 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 15

## God Nodes (most connected - your core abstractions)
1. `SupabaseStore` - 14 edges
2. `createReplyEngine()` - 14 edges
3. `analyzeTexts()` - 13 edges
4. `analyzeCadence()` - 11 edges
5. `DraftReply` - 8 edges
6. `createEmbedder()` - 8 edges
7. `RlmMessage` - 7 edges
8. `LLMRouter` - 7 edges
9. `Contact` - 7 edges
10. `createPineconeClient()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `createEmbedder()`  [EXTRACTED]
  scripts/generate-embeddings.ts → src/embeddings.ts
- `Burst` --references--> `RlmMessage`  [EXTRACTED]
  src/profiler/cadence-analyzer.ts → src/types/index.ts
- `MessagePair` --references--> `RlmMessage`  [EXTRACTED]
  src/profiler/cadence-analyzer.ts → src/types/index.ts
- `ReplyEngineConfig` --references--> `SupabaseStore`  [EXTRACTED]
  src/reply-engine.ts → src/supabase.ts
- `generateProfile()` --calls--> `analyzeTexts()`  [EXTRACTED]
  src/profiler/index.ts → src/profiler/text-analyzer.ts

## Import Cycles
- None detected.

## Communities (17 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.14
Nodes (27): analyzeActivityPatterns(), analyzeBursts(), analyzeCadence(), buildHourlyPatterns(), Burst, CadenceAnalysisResult, emptyCadenceResult(), findBursts() (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (22): LLMRouter, LLMRouterConfig, TIER_BY_CIRCLE, ReplyEngine, ReplyEngineConfig, CircleRank, GeneratedReply, ImageClassification (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (12): createSupabaseStore(), SupabaseStore, CommunicationProfile, Contact, DraftReply, Message, embedSingle, makeContact() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (21): abbrevMsgs, abbrevResult, cadenceResult, casualMsgs, casualResult, conversationMsgs, emojiMsgs, emojiResult (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (14): embedder, engine, execAsync, GOOGLE_API_KEY, pinecone, PINECONE_API_KEY, PINECONE_INDEX, router (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (18): aggregateEmails(), aggregateIMessages(), ContactStats, daysBetween(), EmailMessage, fetchAllEmails(), fetchAllIMessages(), formatDate() (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (15): args, EmailMessage, EMBED_BATCH_SIZE, IMessage, main(), PineconeVector, prepareEmailText(), prepareIMessageText() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (16): analyzeCapsUsage(), analyzeSentiment(), analyzeTexts(), COMMON_ABBREVIATIONS, detectAbbreviations(), detectGreeting(), detectSignoff(), emptyResult() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.24
Nodes (9): createLLMRouter(), callClaude(), callDeepSeek(), callOllama(), generateWithFallback(), CLAUDE_BODY, DEEPSEEK_BODY, KEYS (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.35
Nodes (11): createReplyEngine(), applyCadenceModel(), buildContext(), buildSystemPrompt(), buildUserPrompt(), describeEmojiFreq(), describeSentiment(), findSimilarMessages() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.31
Nodes (7): getContactSummary(), ObsidianContactSummary, parseContactMarkdown(), readObsidianProfile(), SEARCH_DIRS, SEARCH_PATHS, searchContactSummaries()

## Knowledge Gaps
- **83 isolated node(s):** `StyleSummaryInput`, `LLMRouterConfig`, `ReplyEngine`, `GeneratedReply`, `ImageClassification` (+78 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createReplyEngine()` connect `Community 9` to `Community 1`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `createEmbedder()` connect `Community 6` to `Community 9`, `Community 4`, `Community 1`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `createLLMRouter()` connect `Community 8` to `Community 1`, `Community 4`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createReplyEngine()` (e.g. with `generateReply()` and `generateRepliesForNewMessages()`) actually correct?**
  _`createReplyEngine()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `analyzeTexts()` (e.g. with `analyzeSentiment()` and `hasHumorMarkers()`) actually correct?**
  _`analyzeTexts()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `StyleSummaryInput`, `LLMRouterConfig`, `ReplyEngine` to the rest of the system?**
  _83 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.135632183908046 - nodes in this community are weakly interconnected._
> Semantic worker token usage was not exposed by the delegated runtime; the 0-token cost field is not a measured zero.
