import { config } from "../config.js";
import type {
  OllamaGenerateRequest,
  OllamaGenerateResponse,
} from "../types/index.js";

/**
 * Send a prompt to Ollama and get a text response.
 * Uses /api/generate with stream: false for batch processing.
 */
export async function generate(
  prompt: string,
  options?: {
    temperature?: number;
    numPredict?: number;
    model?: string;
  }
): Promise<string> {
  const body: OllamaGenerateRequest = {
    model: options?.model ?? config.ollama.model,
    prompt,
    stream: false,
    options: {
      temperature: options?.temperature ?? 0.1,
      num_predict: options?.numPredict ?? 1024,
    },
  };

  const response = await fetch(`${config.ollama.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ollama.timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Ollama request failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  return data.response;
}

/**
 * Parse JSON from Ollama response, handling markdown code fences.
 */
export function parseJsonResponse<T>(raw: string): T {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Find JSON object or array boundaries
  const jsonStart = cleaned.indexOf("{");
  const arrayStart = cleaned.indexOf("[");
  const start =
    jsonStart === -1
      ? arrayStart
      : arrayStart === -1
        ? jsonStart
        : Math.min(jsonStart, arrayStart);

  if (start === -1) {
    throw new Error(`No JSON found in Ollama response: ${raw.slice(0, 200)}`);
  }

  const isArray = cleaned[start] === "[";
  const end = cleaned.lastIndexOf(isArray ? "]" : "}");
  if (end === -1) {
    throw new Error(`Unclosed JSON in Ollama response: ${raw.slice(0, 200)}`);
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/**
 * Check if Ollama is reachable and the model is available.
 */
export async function healthCheck(): Promise<{
  ok: boolean;
  model: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return {
        ok: false,
        model: config.ollama.model,
        error: `Ollama returned ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      models: Array<{ name: string }>;
    };
    const available = data.models.map((m) => m.name);
    const modelAvailable = available.some(
      (name) =>
        name === config.ollama.model ||
        name.startsWith(config.ollama.model.split(":")[0])
    );

    return {
      ok: modelAvailable,
      model: config.ollama.model,
      error: modelAvailable
        ? undefined
        : `Model ${config.ollama.model} not found. Available: ${available.join(", ")}`,
    };
  } catch (err) {
    return {
      ok: false,
      model: config.ollama.model,
      error: `Ollama unreachable at ${config.ollama.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
