/**
 * generate-embeddings.ts — Fetch all messages from Supabase, generate Google
 * gemini-embedding-001 vectors (3072d), and upsert into Pinecone "reply-like-me" index.
 *
 * Processes: imessage_messages, email_messages
 *
 * Usage: npx tsx scripts/generate-embeddings.ts [--table imessage|email|all] [--batch-size 50]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";
import { createEmbedder } from "../src/embeddings.js";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX = process.env.PINECONE_INDEX || "reply-like-me";

const EMBED_BATCH_SIZE = parseInt(process.env.EMBED_BATCH_SIZE || "50", 10);
const PAGE_SIZE = 500;
const UPSERT_BATCH_SIZE = 100;
const RATE_LIMIT_DELAY_MS = 200;

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const tableArg = args.includes("--table")
  ? args[args.indexOf("--table") + 1]
  : "all";
const batchSize = args.includes("--batch-size")
  ? parseInt(args[args.indexOf("--batch-size") + 1], 10)
  : EMBED_BATCH_SIZE;

// ── Types ───────────────────────────────────────────────────────────────────

interface IMessage {
  id: number;
  text: string;
  ts: string;
  direction: string;
  phone: string;
  analyzed: boolean;
}

interface EmailMessage {
  id: string;
  subject: string;
  body_preview: string;
  from_email: string;
  to_email: string;
  received_at: string;
  category: string | null;
  urgency: string | null;
  sentiment: string | null;
}

interface PineconeVector {
  id: string;
  values: number[];
  metadata: RecordMetadata;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(text: string, maxChars: number = 2000): string {
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function prepareIMessageText(msg: IMessage): string {
  const dir = msg.direction === "inbound" ? "from" : "to";
  return `[iMessage ${dir} ${msg.phone}] ${truncateText(msg.text)}`;
}

function prepareEmailText(msg: EmailMessage): string {
  const preview = truncateText(msg.body_preview || "", 1500);
  return `[Email from ${msg.from_email}] Subject: ${msg.subject || "No subject"}\n${preview}`;
}

async function upsertVectors(
  index: ReturnType<Pinecone["index"]>,
  vectors: PineconeVector[]
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
    await index.upsert(batch);
    upserted += batch.length;
  }
  return upserted;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Reply Like Me — Embedding Generator ===\n");
  console.log(`Pinecone index: ${PINECONE_INDEX}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Tables: ${tableArg}\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const embedder = createEmbedder(GOOGLE_API_KEY);
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX);

  let totalEmbedded = 0;

  // ── iMessage Messages ───────────────────────────────────────────────────

  if (tableArg === "all" || tableArg === "imessage") {
    console.log("── Processing iMessage messages ──\n");

    let offset = 0;
    let hasMore = true;
    let imsgCount = 0;

    while (hasMore) {
      const { data: messages, error } = await supabase
        .from("imessage_messages")
        .select("id, text, ts, direction, phone, analyzed")
        .not("text", "is", null)
        .neq("text", "")
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`Supabase error: ${error.message}`);
        break;
      }

      if (!messages || messages.length === 0) {
        hasMore = false;
        break;
      }

      const validMessages = (messages as IMessage[]).filter(
        (m) => m.text && m.text.trim().length >= 3
      );

      if (validMessages.length === 0) {
        offset += PAGE_SIZE;
        continue;
      }

      for (let i = 0; i < validMessages.length; i += batchSize) {
        const batch = validMessages.slice(i, i + batchSize);
        const texts = batch.map(prepareIMessageText);

        try {
          const embeddings = await embedder.embedBatch(texts);

          const vectors: PineconeVector[] = batch.map((msg, idx) => ({
            id: `imsg-${msg.id}`,
            values: embeddings[idx],
            metadata: {
              source: "imessage",
              source_id: String(msg.id),
              phone: msg.phone || "",
              direction: msg.direction || "",
              text: truncateText(msg.text, 500),
              timestamp: msg.ts || "",
            },
          }));

          const upserted = await upsertVectors(index, vectors);
          imsgCount += upserted;
          totalEmbedded += upserted;

          process.stdout.write(
            `\r  iMessage: ${imsgCount} embedded (page offset ${offset})`
          );

          await sleep(RATE_LIMIT_DELAY_MS);
        } catch (err) {
          console.error(
            `\n  Error embedding iMessage batch at offset ${offset + i}:`,
            err instanceof Error ? err.message : err
          );
          await sleep(2000);
        }
      }

      offset += PAGE_SIZE;
      if (messages.length < PAGE_SIZE) hasMore = false;
    }

    console.log(`\n  iMessage complete: ${imsgCount} vectors\n`);
  }

  // ── Email Messages ────────────────────────────────────────────────────

  if (tableArg === "all" || tableArg === "email") {
    console.log("── Processing email messages ──\n");

    let offset = 0;
    let hasMore = true;
    let emailCount = 0;

    while (hasMore) {
      const { data: emails, error } = await supabase
        .from("email_messages")
        .select(
          "id, subject, body_preview, from_email, to_email, received_at, category, urgency, sentiment"
        )
        .order("received_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`Supabase error: ${error.message}`);
        break;
      }

      if (!emails || emails.length === 0) {
        hasMore = false;
        break;
      }

      const validEmails = (emails as EmailMessage[]).filter(
        (e) =>
          (e.subject && e.subject.trim().length > 0) ||
          (e.body_preview && e.body_preview.trim().length > 0)
      );

      if (validEmails.length === 0) {
        offset += PAGE_SIZE;
        continue;
      }

      for (let i = 0; i < validEmails.length; i += batchSize) {
        const batch = validEmails.slice(i, i + batchSize);
        const texts = batch.map(prepareEmailText);

        try {
          const embeddings = await embedder.embedBatch(texts);

          const vectors: PineconeVector[] = batch.map((email, idx) => ({
            id: `email-${email.id}`,
            values: embeddings[idx],
            metadata: {
              source: "email",
              source_id: email.id,
              from_email: email.from_email || "",
              to_email: email.to_email || "",
              subject: truncateText(email.subject || "", 200),
              text: truncateText(email.body_preview || "", 500),
              timestamp: email.received_at || "",
              category: email.category || "",
              urgency: email.urgency || "",
              sentiment: email.sentiment || "",
            },
          }));

          const upserted = await upsertVectors(index, vectors);
          emailCount += upserted;
          totalEmbedded += upserted;

          process.stdout.write(
            `\r  Email: ${emailCount} embedded (page offset ${offset})`
          );

          await sleep(RATE_LIMIT_DELAY_MS);
        } catch (err) {
          console.error(
            `\n  Error embedding email batch at offset ${offset + i}:`,
            err instanceof Error ? err.message : err
          );
          await sleep(2000);
        }
      }

      offset += PAGE_SIZE;
      if (emails.length < PAGE_SIZE) hasMore = false;
    }

    console.log(`\n  Email complete: ${emailCount} vectors\n`);
  }

  // ── Summary ───────────────────────────────────────────────────────────

  console.log("=== Summary ===");
  console.log(`Total vectors upserted: ${totalEmbedded}`);

  const stats = await index.describeIndexStats();
  console.log(`\nPinecone index stats:`);
  console.log(`  Total vectors: ${stats.totalRecordCount}`);
  console.log(`  Namespaces:`, JSON.stringify(stats.namespaces));

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
