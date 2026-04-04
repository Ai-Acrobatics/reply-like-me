import { describe, it, expect } from "vitest";
import { parseJsonResponse } from "../src/ollama/client.js";

describe("parseJsonResponse", () => {
  it("parses clean JSON", () => {
    const result = parseJsonResponse<{ name: string }>(
      '{"name": "test"}'
    );
    expect(result).toEqual({ name: "test" });
  });

  it("strips markdown code fences", () => {
    const result = parseJsonResponse<{ value: number }>(
      '```json\n{"value": 42}\n```'
    );
    expect(result).toEqual({ value: 42 });
  });

  it("handles leading text before JSON", () => {
    const result = parseJsonResponse<{ intent: string }>(
      'Here is the classification:\n{"intent": "question"}'
    );
    expect(result).toEqual({ intent: "question" });
  });

  it("parses arrays", () => {
    const result = parseJsonResponse<string[]>('["a", "b", "c"]');
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("throws on no JSON content", () => {
    expect(() => parseJsonResponse("no json here")).toThrow(
      "No JSON found"
    );
  });

  it("handles code fences without language tag", () => {
    const result = parseJsonResponse<{ ok: boolean }>(
      '```\n{"ok": true}\n```'
    );
    expect(result).toEqual({ ok: true });
  });

  it("handles trailing text after JSON", () => {
    const result = parseJsonResponse<{ count: number }>(
      '{"count": 5}\n\nThat was my analysis.'
    );
    expect(result).toEqual({ count: 5 });
  });
});
