/**
 * LLM Router — PERS-419 (tiered routing + fallback chain)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLLMRouter } from "../src/llm-router.js";
import type { LLMConfig } from "../src/types.js";

const KEYS = { anthropicApiKey: "sk-ant-test", deepseekApiKey: "sk-ds-test" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const CLAUDE_BODY = {
  content: [{ type: "text", text: "hey what's up" }],
  usage: { input_tokens: 10, output_tokens: 5 },
};
const DEEPSEEK_BODY = {
  choices: [{ message: { content: "yo" } }],
  usage: { total_tokens: 21 },
};
const OLLAMA_BODY = { message: { content: "sup" }, eval_count: 4, prompt_eval_count: 6 };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── selectModel ────────────────────────────────────────────────

describe("selectModel — circle rank routing", () => {
  it("routes inner circle to Claude at premium tier", () => {
    const cfg = createLLMRouter(KEYS).selectModel("inner");
    expect(cfg.provider).toBe("claude");
    expect(cfg.tier).toBe("premium");
    expect(cfg.apiKey).toBe(KEYS.anthropicApiKey);
  });

  it("routes key circle to DeepSeek at standard tier", () => {
    const cfg = createLLMRouter(KEYS).selectModel("key");
    expect(cfg.provider).toBe("deepseek");
    expect(cfg.tier).toBe("standard");
  });

  it.each(["outer", "dormant"] as const)("routes %s circle to Ollama at budget tier", (rank) => {
    const cfg = createLLMRouter(KEYS).selectModel(rank);
    expect(cfg.provider).toBe("ollama");
    expect(cfg.tier).toBe("budget");
  });

  it("escalates a high-stakes outer-circle message to Claude", () => {
    const cfg = createLLMRouter(KEYS).selectModel("outer", true);
    expect(cfg.provider).toBe("claude");
    expect(cfg.tier).toBe("premium");
  });

  it("treats highStakes as optional (engine calls it with one arg)", () => {
    expect(() => createLLMRouter(KEYS).selectModel("inner")).not.toThrow();
  });

  it("degrades to Ollama when no paid keys are configured", () => {
    const router = createLLMRouter({});
    expect(router.selectModel("inner").provider).toBe("ollama");
    expect(router.selectModel("key").provider).toBe("ollama");
  });

  it("honours a custom Ollama endpoint", () => {
    const cfg = createLLMRouter({ ollamaEndpoint: "http://localhost:11434" }).selectModel("outer");
    expect(cfg.endpoint).toBe("http://localhost:11434");
  });
});

// ── getTierForCircle ───────────────────────────────────────────

describe("getTierForCircle", () => {
  it("maps every circle rank to its nominal policy tier", () => {
    const router = createLLMRouter(KEYS);
    expect(router.getTierForCircle("inner")).toBe("premium");
    expect(router.getTierForCircle("key")).toBe("standard");
    expect(router.getTierForCircle("outer")).toBe("budget");
    expect(router.getTierForCircle("dormant")).toBe("budget");
  });

  it("reports the policy tier even when keys are missing and routing degrades", () => {
    // Regression: the engine reports this in its reasoning string. It must describe
    // the policy, not silently mirror the degraded runtime choice.
    const router = createLLMRouter({});
    expect(router.selectModel("inner").tier).toBe("budget");
    expect(router.getTierForCircle("inner")).toBe("premium");
  });
});

// ── generate: provider payloads ────────────────────────────────

describe("generate — provider request shapes", () => {
  it("sends system and user prompts as separate Claude fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(CLAUDE_BODY));
    const router = createLLMRouter(KEYS);
    const res = await router.generate(router.selectModel("inner"), "SYSTEM", "USER");

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe(KEYS.anthropicApiKey);
    expect(body.system).toBe("SYSTEM");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
    expect(res).toMatchObject({ text: "hey what's up", provider: "claude", tokensUsed: 15 });
  });

  it("sends system and user prompts as separate DeepSeek messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEEPSEEK_BODY));
    const router = createLLMRouter(KEYS);
    const res = await router.generate(router.selectModel("key"), "SYSTEM", "USER");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "USER" },
    ]);
    expect(res).toMatchObject({ text: "yo", provider: "deepseek", tokensUsed: 21 });
  });

  it("posts to the Ollama chat endpoint with streaming disabled", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(OLLAMA_BODY));
    const router = createLLMRouter({ ollamaEndpoint: "http://ollama.test" });
    const res = await router.generate(router.selectModel("outer"), "SYSTEM", "USER");

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("http://ollama.test/api/chat");
    expect(body.stream).toBe(false);
    expect(body.messages[1]).toEqual({ role: "user", content: "USER" });
    expect(res).toMatchObject({ text: "sup", provider: "ollama", tokensUsed: 10 });
  });

  it("does not drop the user prompt (regression: generate was called with 3 args, accepted 2)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(CLAUDE_BODY));
    const router = createLLMRouter(KEYS);
    await router.generate(router.selectModel("inner"), "SYSTEM", "THE ACTUAL INBOUND MESSAGE");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(body)).toContain("THE ACTUAL INBOUND MESSAGE");
  });

  it("rejects a Claude config with no API key", async () => {
    const router = createLLMRouter({});
    const cfg: LLMConfig = {
      provider: "claude",
      model: "claude-sonnet-4-6-20250514",
      tier: "premium",
      endpoint: "https://api.anthropic.com/v1/messages",
      maxTokens: 500,
      temperature: 0.7,
    };
    fetchMock.mockResolvedValue(jsonResponse(OLLAMA_BODY));
    // Falls through to Ollama rather than throwing — the chain never fails silently.
    const res = await router.generate(cfg, "S", "U");
    expect(res.provider).toBe("ollama");
  });
});

// ── generate: fallback chain ───────────────────────────────────

describe("generate — fallback chain", () => {
  it("falls back Claude -> DeepSeek when Claude errors", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, false, 529))
      .mockResolvedValueOnce(jsonResponse(DEEPSEEK_BODY));

    const router = createLLMRouter(KEYS);
    const res = await router.generate(router.selectModel("inner"), "S", "U");

    expect(res.provider).toBe("deepseek");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back all the way to Ollama when Claude and DeepSeek both fail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse(OLLAMA_BODY));

    const router = createLLMRouter(KEYS);
    const res = await router.generate(router.selectModel("inner"), "S", "U");

    expect(res.provider).toBe("ollama");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws once every provider in the chain fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    const router = createLLMRouter(KEYS);
    await expect(router.generate(router.selectModel("inner"), "S", "U")).rejects.toThrow(
      /Ollama API error 500/,
    );
  });

  it("propagates network-level failures into the fallback chain", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(DEEPSEEK_BODY));

    const router = createLLMRouter(KEYS);
    const res = await router.generate(router.selectModel("inner"), "S", "U");
    expect(res.provider).toBe("deepseek");
  });
});
