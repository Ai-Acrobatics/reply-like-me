import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Ollama client before importing classifier
vi.mock("../src/ollama/client.js", () => ({
  generate: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

import { classifyMessage, classifyBatch } from "../src/pipeline/classifier.js";
import { generate, parseJsonResponse } from "../src/ollama/client.js";
import type { MessageRow } from "../src/types/index.js";

const mockGenerate = vi.mocked(generate);
const mockParse = vi.mocked(parseJsonResponse);

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "msg-1",
    contact_id: "contact-1",
    handle_id: null,
    text: "Hey, are we still on for lunch tomorrow?",
    is_from_me: false,
    timestamp: "2026-04-04T10:00:00Z",
    chat_id: null,
    has_attachment: false,
    service: "iMessage",
    created_at: "2026-04-04T10:00:00Z",
    ...overrides,
  };
}

describe("classifyMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies a normal message", async () => {
    const classification = {
      intent: "question" as const,
      topic: "logistics" as const,
      urgency: "medium" as const,
      sentiment: "neutral" as const,
      confidence: 0.9,
    };

    mockGenerate.mockResolvedValue(JSON.stringify(classification));
    mockParse.mockReturnValue(classification);

    const result = await classifyMessage(makeMessage());

    expect(result).toEqual(classification);
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it("returns null for empty messages", async () => {
    const result = await classifyMessage(makeMessage({ text: "" }));
    expect(result).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns null for null text", async () => {
    const result = await classifyMessage(makeMessage({ text: null }));
    expect(result).toBeNull();
  });

  it("returns null for single non-letter characters", async () => {
    const result = await classifyMessage(makeMessage({ text: "👍" }));
    expect(result).toBeNull();
  });

  it("handles Ollama errors gracefully", async () => {
    mockGenerate.mockRejectedValue(new Error("Connection refused"));

    const result = await classifyMessage(makeMessage());
    expect(result).toBeNull();
  });
});

describe("classifyBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies multiple messages and returns classification rows", async () => {
    const classification = {
      intent: "statement" as const,
      topic: "business" as const,
      urgency: "low" as const,
      sentiment: "positive" as const,
      confidence: 0.85,
    };

    mockGenerate.mockResolvedValue(JSON.stringify(classification));
    mockParse.mockReturnValue(classification);

    const messages = [
      makeMessage({ id: "msg-1", text: "The project is going great" }),
      makeMessage({ id: "msg-2", text: "We shipped the new feature" }),
    ];

    const results = await classifyBatch(messages);

    expect(results).toHaveLength(2);
    expect(results[0].message_id).toBe("msg-1");
    expect(results[0].intent).toBe("statement");
    expect(results[1].message_id).toBe("msg-2");
    expect(results[0].model_used).toContain("llama");
  });

  it("skips messages that fail classification", async () => {
    const classification = {
      intent: "greeting" as const,
      topic: "social" as const,
      urgency: "low" as const,
      sentiment: "positive" as const,
      confidence: 0.95,
    };

    // First call succeeds, second fails
    mockGenerate
      .mockResolvedValueOnce(JSON.stringify(classification))
      .mockRejectedValueOnce(new Error("timeout"));
    mockParse.mockReturnValue(classification);

    const messages = [
      makeMessage({ id: "msg-1", text: "Hey there!" }),
      makeMessage({ id: "msg-2", text: "What's up?" }),
    ];

    const results = await classifyBatch(messages);
    expect(results).toHaveLength(1);
    expect(results[0].message_id).toBe("msg-1");
  });
});
