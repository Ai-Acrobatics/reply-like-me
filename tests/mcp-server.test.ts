/**
 * MCP server surface — PERS-405 (deploy Reply Like Me as an MCP tool)
 *
 * Boots the real stdio server in a child process with throwaway credentials and
 * drives a genuine JSON-RPC handshake. No network calls are made: the Supabase,
 * Pinecone and Gemini clients are all constructed lazily.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FAKE_ENV = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_KEY: "fake-service-key",
  GOOGLE_API_KEY: "fake-google-key",
  PINECONE_API_KEY: "fake-pinecone-key",
  PINECONE_INDEX: "fake-index",
};

const EXPECTED_TOOLS = [
  "generate_reply",
  "generate_reply_by_phone",
  "list_drafts",
  "review_draft",
  "send_draft",
  "contact_lookup",
  "search_messages",
  "draft_stats",
  "get_conversation_context",
];

let proc: ChildProcessWithoutNullStreams;
let stdout = "";

function send(msg: unknown) {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}

/** Resolve when a JSON-RPC response with the given id appears on stdout. */
function waitFor(id: number, timeoutMs = 20_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for response id=${id}`)),
      timeoutMs,
    );

    const check = () => {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.off("data", check);
            resolve(msg);
            return;
          }
        } catch {
          // partial line — wait for more data
        }
      }
    };

    proc.stdout.on("data", check);
    check();
  });
}

beforeAll(async () => {
  proc = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, ...FAKE_ENV },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  proc.stdout.on("data", (d) => {
    stdout += d.toString();
  });

  // Wait for the server to announce itself on stderr before handshaking.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 30_000);
    proc.stderr.on("data", (d: Buffer) => {
      if (d.toString().includes("MCP server running on stdio")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
  });

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    },
  });
  await waitFor(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
}, 60_000);

afterAll(() => {
  proc?.kill();
});

describe("MCP server — PERS-405", () => {
  it("completes the initialize handshake and identifies itself", async () => {
    const res = await waitFor(1);
    expect(res.result.serverInfo.name).toBe("reply-like-me");
    expect(res.result.capabilities.tools).toBeDefined();
  });

  it("advertises every Reply Like Me tool", async () => {
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const res = await waitFor(2);
    const names = res.result.tools.map((t: any) => t.name);

    for (const tool of EXPECTED_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it("publishes an input schema for every tool", async () => {
    send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const res = await waitFor(3);

    for (const tool of res.result.tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} needs an inputSchema`).toBeDefined();
    }
  });

  it("exposes generate_reply with the contact_id + incoming_message contract", async () => {
    send({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
    const res = await waitFor(4);
    const tool = res.result.tools.find((t: any) => t.name === "generate_reply");

    expect(Object.keys(tool.inputSchema.properties)).toEqual(
      expect.arrayContaining(["contact_id", "incoming_message"]),
    );
  });
});
