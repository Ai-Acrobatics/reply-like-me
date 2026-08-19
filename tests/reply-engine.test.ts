/**
 * Reply Generation Engine — PERS-403
 *   context retrieval        PERS-418 / REPLY-01
 *   tiered generation        PERS-419 / REPLY-02
 *   cadence-aware splitting  PERS-420 / REPLY-03
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const embedSingle = vi.fn(async () => [0.1, 0.2, 0.3]);
const queryByVector = vi.fn(async () => ({ matches: [] as any[] }));

vi.mock("../src/embeddings.js", () => ({
  createEmbedder: () => ({ embedSingle, embedBatch: vi.fn() }),
  EMBEDDING_DIMENSION: 3072,
}));

vi.mock("../src/pinecone.js", () => ({
  createPineconeClient: () => ({ queryByVector, upsertBatch: vi.fn(), getStats: vi.fn() }),
}));

const { createReplyEngine } = await import("../src/reply-engine.js");
import type { CommunicationProfile, Contact, Message } from "../src/types.js";
import type { SupabaseStore } from "../src/supabase.js";
import type { LLMRouter } from "../src/llm-router.js";

// ── Fixtures ───────────────────────────────────────────────────

function makeContact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    handle_id: "+16195090699",
    display_name: "Elliott",
    phone: "+18057602314",
    email: null,
    relationship_type: "client",
    circle_rank: "key",
    last_message_at: "2026-08-18T10:00:00Z",
    message_count: 412,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-18T10:00:00Z",
    ...over,
  };
}

function makeProfile(over: Partial<CommunicationProfile> = {}): CommunicationProfile {
  return {
    id: "p-1",
    contact_id: "c-1",
    formality: 3,
    avg_message_length: 60,
    emoji_frequency: 0.3,
    common_emojis: ["😂", "🔥"],
    greeting_patterns: ["yo"],
    signoff_patterns: ["later"],
    slang_terms: ["bet"],
    topic_distribution: { towing: 0.8 },
    sentiment_baseline: 0.4,
    avg_response_delay_minutes: 12,
    avg_bubbles_per_reply: 2,
    avg_chars_per_bubble: 40,
    sample_messages: ["yo whats good", "bet, on it", "later man"],
    updated_at: "2026-08-18T10:00:00Z",
    ...over,
  };
}

function makeMessages(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    contact_id: "c-1",
    handle_id: "+18057602314",
    text: `message ${i}`,
    is_from_me: i % 2 === 0,
    timestamp: `2026-08-18T0${i}:00:00Z`,
    thread_id: "t-1",
    has_attachment: false,
  }));
}

function makeStore(over: Partial<SupabaseStore> = {}): SupabaseStore {
  return {
    client: {} as any,
    getContact: vi.fn(async () => makeContact()),
    getContactByPhone: vi.fn(),
    getContactByHandle: vi.fn(),
    getProfile: vi.fn(async () => makeProfile()),
    getRecentMessages: vi.fn(async () => makeMessages(6)),
    getPendingDrafts: vi.fn(),
    getDraft: vi.fn(),
    updateDraftStatus: vi.fn(),
    saveDraft: vi.fn(async (d: any) => ({
      ...d,
      id: "d-1",
      created_at: "2026-08-19T00:00:00Z",
      reviewed_at: null,
    })),
    getDraftStats: vi.fn(),
    ...over,
  } as unknown as SupabaseStore;
}

function makeRouter(text = "yo|||on it"): LLMRouter {
  return {
    selectModel: vi.fn(() => ({
      provider: "deepseek" as const,
      model: "deepseek-chat",
      tier: "standard" as const,
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "k",
      maxTokens: 500,
      temperature: 0.7,
    })),
    getTierForCircle: vi.fn(() => "standard" as const),
    generate: vi.fn(async () => ({
      text,
      provider: "deepseek" as const,
      model: "deepseek-chat",
      tokensUsed: 42,
    })),
  };
}

function makeEngine(store = makeStore(), router = makeRouter()) {
  return {
    engine: createReplyEngine({
      store,
      router,
      googleApiKey: "g",
      pineconeApiKey: "p",
      pineconeIndex: "idx",
    }),
    store,
    router,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryByVector.mockResolvedValue({ matches: [] });
  embedSingle.mockResolvedValue([0.1, 0.2, 0.3]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── PERS-418: context retrieval ────────────────────────────────

describe("buildContext — PERS-418 context retrieval", () => {
  it("assembles contact, profile, recent messages and similar messages", async () => {
    const { engine, store } = makeEngine();
    const ctx = await engine.buildContext("c-1", "you around?");

    expect(ctx.contact.id).toBe("c-1");
    expect(ctx.profile?.contact_id).toBe("c-1");
    expect(ctx.recentMessages).toHaveLength(6);
    expect(ctx.incomingMessage).toBe("you around?");
    expect(store.getRecentMessages).toHaveBeenCalledWith("c-1", 20);
  });

  it("honours configured recent/similar limits", async () => {
    const store = makeStore();
    const engine = createReplyEngine({
      store,
      router: makeRouter(),
      googleApiKey: "g",
      pineconeApiKey: "p",
      pineconeIndex: "idx",
      recentMessageLimit: 5,
      similarMessageLimit: 2,
    });

    await engine.buildContext("c-1", "hi");
    expect(store.getRecentMessages).toHaveBeenCalledWith("c-1", 5);
    expect(queryByVector).toHaveBeenCalledWith(expect.anything(), 2, expect.anything());
  });

  it("throws when the contact does not exist", async () => {
    const { engine } = makeEngine(makeStore({ getContact: vi.fn(async () => null) as any }));
    await expect(engine.buildContext("nope", "hi")).rejects.toThrow(/Contact not found: nope/);
  });

  it("tolerates a missing communication profile", async () => {
    const { engine } = makeEngine(makeStore({ getProfile: vi.fn(async () => null) as any }));
    const ctx = await engine.buildContext("c-1", "hi");
    expect(ctx.profile).toBeNull();
  });

  it("queries Pinecone with the metadata keys the index is actually written with", async () => {
    // Regression: the filter used {contact_id, is_from_me}, but generate-embeddings.ts
    // upserts {source, source_id, phone, direction, text, timestamp}. The old filter
    // matched zero vectors and the empty result was swallowed by the catch block.
    const { engine } = makeEngine();
    await engine.buildContext("c-1", "you around?");

    expect(embedSingle).toHaveBeenCalledWith("you around?");
    const filter = queryByVector.mock.calls[0][2];
    expect(filter).toEqual({ phone: "+18057602314", direction: "outbound" });
    expect(filter).not.toHaveProperty("contact_id");
    expect(filter).not.toHaveProperty("is_from_me");
  });

  it("maps Pinecone matches into similar messages", async () => {
    queryByVector.mockResolvedValue({
      matches: [
        { score: 0.91, metadata: { text: "bet, on it", direction: "outbound", timestamp: "2026-07-01T00:00:00Z" } },
        { score: 0.72, metadata: { text: "yo whats good", direction: "outbound", timestamp: "2026-07-02T00:00:00Z" } },
      ],
    });

    const { engine } = makeEngine();
    const ctx = await engine.buildContext("c-1", "hi");

    expect(ctx.similarMessages).toHaveLength(2);
    expect(ctx.similarMessages[0]).toMatchObject({
      text: "bet, on it",
      score: 0.91,
      is_from_me: true,
      contact_name: "Elliott",
    });
  });

  it("skips vector search entirely for a contact with no phone", async () => {
    const { engine } = makeEngine(
      makeStore({ getContact: vi.fn(async () => makeContact({ phone: null })) as any }),
    );
    const ctx = await engine.buildContext("c-1", "hi");

    expect(ctx.similarMessages).toEqual([]);
    expect(embedSingle).not.toHaveBeenCalled();
  });

  it("treats a Pinecone outage as non-fatal", async () => {
    queryByVector.mockRejectedValue(new Error("pinecone down"));
    const { engine } = makeEngine();
    const ctx = await engine.buildContext("c-1", "hi");

    expect(ctx.similarMessages).toEqual([]);
    expect(ctx.recentMessages).toHaveLength(6);
  });
});

// ── Prompt construction ────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("embeds the contact's measured style attributes", () => {
    const { engine } = makeEngine();
    const p = engine.buildSystemPrompt(makeContact(), makeProfile());

    expect(p).toContain("Elliott");
    expect(p).toContain("Formality level: 3/10");
    expect(p).toContain("😂 🔥");
    expect(p).toContain("bet");
    expect(p).toContain("2.0 message bubble(s)");
    expect(p).toContain("|||");
  });

  it("includes sample messages, capped at five", () => {
    const { engine } = makeEngine();
    const profile = makeProfile({
      sample_messages: ["a", "b", "c", "d", "e", "f", "g"],
    });
    const p = engine.buildSystemPrompt(makeContact(), profile);

    expect(p).toContain('- "a"');
    expect(p).toContain('- "e"');
    expect(p).not.toContain('- "f"');
  });

  it("falls back to a general style when no profile exists", () => {
    const { engine } = makeEngine();
    const p = engine.buildSystemPrompt(makeContact(), null);

    expect(p).toContain("No specific style profile available");
    expect(p).not.toContain("Formality level");
  });

  it("falls back to the handle when the contact has no display name", () => {
    const { engine } = makeEngine();
    const p = engine.buildSystemPrompt(makeContact({ display_name: null }), null);
    expect(p).toContain("+16195090699");
  });
});

describe("buildUserPrompt", () => {
  it("includes recent conversation, similar messages, and the inbound text", async () => {
    queryByVector.mockResolvedValue({
      matches: [{ score: 0.9, metadata: { text: "bet, on it", direction: "outbound" } }],
    });
    const { engine } = makeEngine();
    const ctx = await engine.buildContext("c-1", "you around?");
    const p = engine.buildUserPrompt(ctx);

    expect(p).toContain("RECENT CONVERSATION:");
    expect(p).toContain("[Julian]: message 0");
    expect(p).toContain("[Elliott]: message 1");
    expect(p).toContain("SIMILAR PAST MESSAGES FROM JULIAN");
    expect(p).toContain('"you around?"');
  });

  it("caps the transcript at the last ten messages", async () => {
    const { engine } = makeEngine(
      makeStore({ getRecentMessages: vi.fn(async () => makeMessages(14)) as any }),
    );
    const ctx = await engine.buildContext("c-1", "hi");
    const p = engine.buildUserPrompt(ctx);

    expect(p).not.toContain("message 3\n");
    expect(p).toContain("message 13");
  });
});

// ── PERS-420: cadence-aware splitting ──────────────────────────

describe("applyCadenceModel — PERS-420 cadence splitting", () => {
  it("splits on the ||| delimiter", () => {
    const { engine } = makeEngine();
    expect(engine.applyCadenceModel("yo|||on it|||later", null)).toEqual(["yo", "on it", "later"]);
  });

  it("returns a single bubble when no delimiter is present", () => {
    const { engine } = makeEngine();
    expect(engine.applyCadenceModel("just one message", null)).toEqual(["just one message"]);
  });

  it("drops empty segments from a ragged split", () => {
    const { engine } = makeEngine();
    expect(engine.applyCadenceModel("yo|||  |||on it", null)).toEqual(["yo", "on it"]);
  });

  it("merges toward the contact's typical bubble count", () => {
    const { engine } = makeEngine();
    const out = engine.applyCadenceModel("a|||b|||c|||d", makeProfile({ avg_bubbles_per_reply: 1 }));
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.join(" ")).toContain("a");
    expect(out.join(" ")).toContain("d");
  });

  it("merges the shortest adjacent pair first", () => {
    const { engine } = makeEngine();
    const out = engine.applyCadenceModel(
      "a|||b|||a much much longer bubble here",
      makeProfile({ avg_bubbles_per_reply: 1 }),
    );
    expect(out).toEqual(["a b", "a much much longer bubble here"]);
  });

  it("leaves bubble count alone for a chatty contact", () => {
    const { engine } = makeEngine();
    const out = engine.applyCadenceModel("a|||b|||c", makeProfile({ avg_bubbles_per_reply: 3 }));
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("never merges below a single bubble", () => {
    const { engine } = makeEngine();
    const out = engine.applyCadenceModel("only one", makeProfile({ avg_bubbles_per_reply: 1 }));
    expect(out).toEqual(["only one"]);
  });

  it("strips wrapping quotes and LLM role prefixes", () => {
    const { engine } = makeEngine();
    expect(engine.applyCadenceModel('"quoted reply"', null)).toEqual(["quoted reply"]);
    expect(engine.applyCadenceModel("Julian: hey there", null)).toEqual(["hey there"]);
    expect(engine.applyCadenceModel("Draft: hey there", null)).toEqual(["hey there"]);
  });

  it("returns an empty array for whitespace-only output", () => {
    const { engine } = makeEngine();
    expect(engine.applyCadenceModel("   ", null)).toEqual([]);
  });
});

// ── Confidence scoring ─────────────────────────────────────────

describe("scoreConfidence", () => {
  const baseCtx = (over: any = {}) => ({
    contact: makeContact(),
    profile: makeProfile(),
    recentMessages: makeMessages(6),
    similarMessages: [
      { text: "a", score: 0.9, is_from_me: true, contact_name: "Elliott", timestamp: "" },
      { text: "b", score: 0.8, is_from_me: true, contact_name: "Elliott", timestamp: "" },
    ],
    incomingMessage: "hi",
    ...over,
  });

  // Profile norm is 2 bubbles x 40 chars = ~80 expected chars.
  const WELL_SIZED = ["yeah I'm around, what do you need", "can jump on it this afternoon"];

  it("scores a fully-supported, correctly-sized reply highest", () => {
    const { engine } = makeEngine();
    expect(engine.scoreConfidence(baseCtx(), WELL_SIZED)).toBeCloseTo(0.95, 5);
  });

  it("penalises a reply far shorter than the contact's norm", () => {
    const { engine } = makeEngine();
    expect(engine.scoreConfidence(baseCtx(), ["k"])).toBeCloseTo(0.8, 5);
  });

  it("scores a bare context at the 0.5 baseline", () => {
    const { engine } = makeEngine();
    const score = engine.scoreConfidence(
      baseCtx({ profile: null, recentMessages: [], similarMessages: [] }),
      ["yo"],
    );
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("penalises a reply far longer than the contact's norm", () => {
    const { engine } = makeEngine();
    expect(engine.scoreConfidence(baseCtx(), ["x".repeat(600)])).toBeLessThan(
      engine.scoreConfidence(baseCtx(), WELL_SIZED),
    );
  });

  it("applies no length penalty when the contact has no profile", () => {
    const { engine } = makeEngine();
    const ctx = baseCtx({ profile: null });
    expect(engine.scoreConfidence(ctx, ["x".repeat(600)])).toBeCloseTo(
      engine.scoreConfidence(ctx, ["k"]),
      5,
    );
  });

  it("always returns a value within [0, 1]", () => {
    const { engine } = makeEngine();
    for (const bubbles of [[""], ["yo"], ["x".repeat(5000)]]) {
      const s = engine.scoreConfidence(baseCtx(), bubbles);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ── PERS-403: end-to-end generation ────────────────────────────

describe("generateReply — PERS-403 end-to-end", () => {
  it("routes by circle rank and persists a pending draft", async () => {
    const { engine, store, router } = makeEngine();
    const draft = await engine.generateReply("c-1", "you around?");

    expect(router.selectModel).toHaveBeenCalledWith("key");
    expect(draft.bubbles).toEqual(["yo", "on it"]);
    expect(draft.status).toBe("pending");
    expect(draft.llm_provider).toBe("deepseek");
    expect(draft.contact_name).toBe("Elliott");
    expect(draft.contact_phone).toBe("+18057602314");
    expect(draft.incoming_message).toBe("you around?");
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("passes the system and user prompts through as separate arguments", async () => {
    const { engine, router } = makeEngine();
    await engine.generateReply("c-1", "you around?");

    const [, systemPrompt, userPrompt] = (router.generate as any).mock.calls[0];
    expect(systemPrompt).toContain("You are Julian Bradley");
    expect(userPrompt).toContain("you around?");
    expect(systemPrompt).not.toContain("you around?");
  });

  it("records routing and context provenance in the reasoning string", async () => {
    const { engine, router } = makeEngine();
    const draft = await engine.generateReply("c-1", "hi");

    expect(router.getTierForCircle).toHaveBeenCalledWith("key");
    expect(draft.reasoning).toContain("Circle: key → tier: standard");
    expect(draft.reasoning).toContain("Model: deepseek/deepseek-chat");
    expect(draft.reasoning).toContain("Recent msgs: 6");
    expect(draft.reasoning).toContain("Tokens: 42");
  });

  it("applies the contact's cadence to the raw LLM output", async () => {
    const { engine } = makeEngine(makeStore(), makeRouter("a|||b|||c|||d"));
    const draft = await engine.generateReply("c-1", "hi");
    expect(draft.bubbles.length).toBeLessThanOrEqual(3);
  });

  it("surfaces a contact lookup failure to the caller", async () => {
    const { engine } = makeEngine(makeStore({ getContact: vi.fn(async () => null) as any }));
    await expect(engine.generateReply("ghost", "hi")).rejects.toThrow(/Contact not found/);
  });
});

describe("generateRepliesForNewMessages — batch", () => {
  it("generates a draft per inbound message", async () => {
    const { engine } = makeEngine();
    const drafts = await engine.generateRepliesForNewMessages([
      { contactId: "c-1", text: "one" },
      { contactId: "c-1", text: "two" },
    ]);
    expect(drafts).toHaveLength(2);
  });

  it("keeps going when one contact fails", async () => {
    const getContact = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(makeContact());
    const { engine } = makeEngine(makeStore({ getContact: getContact as any }));

    const drafts = await engine.generateRepliesForNewMessages([
      { contactId: "ghost", text: "one" },
      { contactId: "c-1", text: "two" },
    ]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].incoming_message).toBe("two");
  });
});
