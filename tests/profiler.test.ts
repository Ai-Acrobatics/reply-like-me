import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/ollama/client.js", () => ({
  generate: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

import { buildProfile } from "../src/pipeline/profiler.js";
import { generate, parseJsonResponse } from "../src/ollama/client.js";
import type { MessageRow, MessageClassificationRow } from "../src/types/index.js";

const mockGenerate = vi.mocked(generate);
const mockParse = vi.mocked(parseJsonResponse);

type ClassifiedMessage = MessageRow & {
  classification: MessageClassificationRow | null;
};

function makeMsg(
  overrides: Partial<MessageRow> & {
    classification?: Partial<MessageClassificationRow> | null;
  } = {}
): ClassifiedMessage {
  const { classification, ...msgOverrides } = overrides;
  return {
    id: "msg-1",
    contact_id: "contact-1",
    handle_id: null,
    text: "Hey what's up",
    is_from_me: false,
    timestamp: "2026-04-04T10:00:00Z",
    chat_id: null,
    has_attachment: false,
    service: "iMessage",
    created_at: "2026-04-04T10:00:00Z",
    classification: classification === undefined
      ? {
          id: "cls-1",
          message_id: "msg-1",
          intent: "greeting",
          topic: "social",
          urgency: "low",
          sentiment: "positive",
          confidence: 0.9,
          raw_analysis: null,
          model_used: "llama3.1:70b",
          processed_at: "2026-04-04T10:00:00Z",
        }
      : (classification as MessageClassificationRow | null),
    ...msgOverrides,
  };
}

describe("buildProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null with fewer than 3 messages from the contact", async () => {
    const messages = [
      makeMsg({ is_from_me: false }),
      makeMsg({ is_from_me: false, id: "msg-2" }),
    ];

    const result = await buildProfile("contact-1", messages);
    expect(result).toBeNull();
  });

  it("builds a profile with sufficient messages", async () => {
    const styleAnalysis = {
      formality_score: 3,
      emoji_frequency: 1.5,
      common_emojis: ["😂", "🔥"],
      greeting_patterns: ["yo", "hey"],
      signoff_patterns: ["later", "peace"],
      slang_terms: ["ngl", "fr"],
      sentiment_baseline: "positive",
      message_style: "terse" as const,
      uses_caps: true,
      uses_punctuation: false,
    };

    mockGenerate.mockResolvedValue(JSON.stringify(styleAnalysis));
    mockParse.mockReturnValue(styleAnalysis);

    const messages: ClassifiedMessage[] = [
      makeMsg({ id: "m1", is_from_me: true, text: "Hey man", timestamp: "2026-04-04T09:00:00Z" }),
      makeMsg({ id: "m2", is_from_me: false, text: "yo whats good", timestamp: "2026-04-04T09:05:00Z" }),
      makeMsg({ id: "m3", is_from_me: false, text: "ngl bro that was fire 🔥", timestamp: "2026-04-04T09:06:00Z" }),
      makeMsg({ id: "m4", is_from_me: true, text: "For real", timestamp: "2026-04-04T09:10:00Z" }),
      makeMsg({ id: "m5", is_from_me: false, text: "fr fr 😂", timestamp: "2026-04-04T09:15:00Z" }),
    ];

    const profile = await buildProfile("contact-1", messages);

    expect(profile).not.toBeNull();
    expect(profile!.contact_id).toBe("contact-1");
    expect(profile!.formality_score).toBe(3);
    expect(profile!.common_emojis).toEqual(["😂", "🔥"]);
    expect(profile!.slang_terms).toEqual(["ngl", "fr"]);
    expect(profile!.sample_count).toBe(3); // only "their" messages, not Julian's
    expect(profile!.message_style).toBe("terse");
  });

  it("computes response delay correctly", async () => {
    const styleAnalysis = {
      formality_score: 7,
      emoji_frequency: 0,
      common_emojis: [],
      greeting_patterns: ["Hello"],
      signoff_patterns: ["Best"],
      slang_terms: [],
      sentiment_baseline: "neutral",
      message_style: "moderate" as const,
      uses_caps: false,
      uses_punctuation: true,
    };

    mockGenerate.mockResolvedValue(JSON.stringify(styleAnalysis));
    mockParse.mockReturnValue(styleAnalysis);

    const messages: ClassifiedMessage[] = [
      // Julian sends at 9:00
      makeMsg({ id: "m1", is_from_me: true, text: "Can you review this?", timestamp: "2026-04-04T09:00:00Z" }),
      // They reply at 9:10 (10 min delay)
      makeMsg({ id: "m2", is_from_me: false, text: "Sure, let me take a look", timestamp: "2026-04-04T09:10:00Z" }),
      // Julian sends at 9:15
      makeMsg({ id: "m3", is_from_me: true, text: "Thanks!", timestamp: "2026-04-04T09:15:00Z" }),
      // They reply at 9:45 (30 min delay)
      makeMsg({ id: "m4", is_from_me: false, text: "Done, looks good", timestamp: "2026-04-04T09:45:00Z" }),
      // Extra message from them
      makeMsg({ id: "m5", is_from_me: false, text: "I'll push the changes", timestamp: "2026-04-04T09:46:00Z" }),
    ];

    const profile = await buildProfile("contact-1", messages);

    expect(profile).not.toBeNull();
    // Average of 10 and 30 = 20 minutes
    expect(profile!.avg_response_delay_minutes).toBe(20);
  });

  it("handles Ollama failure gracefully with fallback stats", async () => {
    mockGenerate.mockRejectedValue(new Error("timeout"));

    const messages: ClassifiedMessage[] = [
      makeMsg({ id: "m1", is_from_me: false, text: "Hey there buddy" }),
      makeMsg({ id: "m2", is_from_me: false, text: "What's going on today?" }),
      makeMsg({ id: "m3", is_from_me: false, text: "Just checking in on the project status" }),
    ];

    const profile = await buildProfile("contact-1", messages);

    // Should still build a profile with statistical defaults
    expect(profile).not.toBeNull();
    expect(profile!.formality_score).toBe(5); // default
    expect(profile!.sample_count).toBe(3);
  });
});
