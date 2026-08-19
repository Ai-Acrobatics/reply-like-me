/**
 * LLM Router — Reply Like Me
 *
 * Tiered routing of reply generation across LLM providers:
 *   - Premium (inner circle): Claude Sonnet 4.6
 *   - Standard (key contacts): DeepSeek V4
 *   - Budget (outer/dormant): Ollama (llama-3.3-70b on VPS)
 *
 * Each provider has a fallback chain:
 *   Claude → DeepSeek → Ollama (never fails silently)
 */

import type { LLMConfig, LLMResponse, LLMTier, CircleRank } from "./types.js";

export interface LLMRouterConfig {
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  ollamaEndpoint?: string;
}

export interface LLMRouter {
  selectModel(circleRank: CircleRank, highStakes?: boolean): LLMConfig;
  /** Nominal policy tier for a circle rank, independent of which keys are configured. */
  getTierForCircle(circleRank: CircleRank): LLMTier;
  generate(
    config: LLMConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse>;
}

const TIER_BY_CIRCLE: Record<CircleRank, LLMTier> = {
  inner: "premium",
  key: "standard",
  outer: "budget",
  dormant: "budget",
};

const OLLAMA_DEFAULT = "http://100.82.80.45:11434";

export function createLLMRouter(config: LLMRouterConfig): LLMRouter {
  const ollamaEndpoint = config.ollamaEndpoint ?? OLLAMA_DEFAULT;

  // ── Provider implementations ──────────────────────────────

  async function callClaude(
    cfg: LLMConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    if (!cfg.apiKey) throw new Error("Anthropic API key required for Claude");

    const resp = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Claude API error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      content: { type: string; text: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      text: data.content[0]?.text ?? "",
      provider: "claude",
      model: cfg.model,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  }

  async function callDeepSeek(
    cfg: LLMConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    if (!cfg.apiKey) throw new Error("DeepSeek API key required");

    const resp = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`DeepSeek API error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
      usage: { total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? "",
      provider: "deepseek",
      model: cfg.model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  }

  async function callOllama(
    cfg: LLMConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    const resp = await fetch(`${cfg.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        options: {
          temperature: cfg.temperature,
          num_predict: cfg.maxTokens,
        },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama API error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      text: data.message?.content ?? "",
      provider: "ollama",
      model: cfg.model,
      tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
    };
  }

  // ── Fallback chain ────────────────────────────────────────

  async function generateWithFallback(
    cfg: LLMConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMResponse> {
    const providerFns = { claude: callClaude, deepseek: callDeepSeek, ollama: callOllama };
    const fallbackOrder: Array<{ provider: typeof cfg.provider; getCfg: () => LLMConfig }> = [
      { provider: cfg.provider, getCfg: () => cfg },
    ];

    // Add fallbacks
    if (cfg.provider !== "deepseek" && config.deepseekApiKey) {
      fallbackOrder.push({
        provider: "deepseek",
        getCfg: () => ({
          provider: "deepseek",
          model: "deepseek-chat",
          tier: "standard",
          endpoint: "https://api.deepseek.com/v1/chat/completions",
          apiKey: config.deepseekApiKey,
          maxTokens: cfg.maxTokens,
          temperature: cfg.temperature,
        }),
      });
    }
    if (cfg.provider !== "ollama") {
      fallbackOrder.push({
        provider: "ollama",
        getCfg: () => ({
          provider: "ollama",
          model: "llama3.3:70b",
          tier: "budget",
          endpoint: ollamaEndpoint,
          maxTokens: cfg.maxTokens,
          temperature: cfg.temperature,
        }),
      });
    }

    for (const fb of fallbackOrder) {
      try {
        return await providerFns[fb.provider](fb.getCfg(), systemPrompt, userPrompt);
      } catch (err) {
        console.error(`[llm-router] ${fb.provider} failed:`, (err as Error).message);
        if (fb === fallbackOrder[fallbackOrder.length - 1]) throw err;
      }
    }

    throw new Error("All LLM providers failed");
  }

  // ── Public interface ──────────────────────────────────────

  return {
    selectModel(circleRank: CircleRank, highStakes = false): LLMConfig {
      // Premium: inner circle or high-stakes messages
      if (circleRank === "inner" || highStakes) {
        if (config.anthropicApiKey) {
          return {
            provider: "claude",
            model: "claude-sonnet-4-6-20250514",
            tier: "premium",
            endpoint: "https://api.anthropic.com/v1/messages",
            apiKey: config.anthropicApiKey,
            maxTokens: 500,
            temperature: 0.7,
          };
        }
      }

      // Standard: key contacts
      if (circleRank === "key" && config.deepseekApiKey) {
        return {
          provider: "deepseek",
          model: "deepseek-chat",
          tier: "standard",
          endpoint: "https://api.deepseek.com/v1/chat/completions",
          apiKey: config.deepseekApiKey,
          maxTokens: 500,
          temperature: 0.7,
        };
      }

      // Budget: outer/dormant or fallback when no API keys
      return {
        provider: "ollama",
        model: "llama3.3:70b",
        tier: "budget",
        endpoint: ollamaEndpoint,
        maxTokens: 500,
        temperature: 0.7,
      };
    },

    getTierForCircle(circleRank: CircleRank): LLMTier {
      return TIER_BY_CIRCLE[circleRank] ?? "budget";
    },

    async generate(
      llmConfig: LLMConfig,
      systemPrompt: string,
      userPrompt: string,
    ): Promise<LLMResponse> {
      return generateWithFallback(llmConfig, systemPrompt, userPrompt);
    },
  };
}
