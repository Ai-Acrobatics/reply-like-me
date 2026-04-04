/**
 * generate-freshness-dashboard.ts — Build a Contact Freshness Dashboard
 * in the Obsidian vault from iMessage + email data in Supabase.
 *
 * Outputs: /opt/agency-workspace/obsidian-vault/Reply-Like-Me/Contact-Freshness-Dashboard.md
 *
 * Usage: npx tsx scripts/generate-freshness-dashboard.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

const OBSIDIAN_BASE = "/opt/agency-workspace/obsidian-vault";
const OUTPUT_DIR = join(OBSIDIAN_BASE, "Reply-Like-Me");
const OUTPUT_FILE = join(OUTPUT_DIR, "Contact-Freshness-Dashboard.md");

// Freshness thresholds (days)
const FRESH_THRESHOLD = 7;
const WARM_THRESHOLD = 14;
const COOLING_THRESHOLD = 30;
const STALE_THRESHOLD = 60;
// Anything beyond STALE_THRESHOLD is "dormant"

// ── Known Contacts Map (phone → name) ──────────────────────────────────

const KNOWN_CONTACTS: Record<string, string> = {
  "+16195090699": "Julian Bradley (self)",
  "+916284803615": "Hitesh Juneja",
  "+18589268708": "Sean Gelt (Hafnia)",
  "+18584499950": "Fred Cary (Sahara)",
  "+16122144492": "Vijay Deshmukh",
  "+16126163271": "Anagha Deshmukh",
  "+14158958578": "Connor Rankin",
  "+18182812787": "JJ (Music City)",
  "+15622251786": "Andrea Cruz (Volare)",
  "+14257372599": "Raghad Seleem",
};

// ── Types ──────────────────────────────────────────────────────────────

interface IMessage {
  id: number;
  phone: string | null;
  text: string | null;
  ts: string | null;
  direction: string | null;
}

interface EmailMessage {
  id: string;
  from_email: string | null;
  to_email: string | null;
  received_at: string | null;
  subject: string | null;
}

interface ContactStats {
  identifier: string;
  displayName: string;
  source: "imessage" | "email";
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  daysSinceLastMessage: number;
  freshnessStatus: string;
  freshnessEmoji: string;
  responseRatio: number; // outbound / total
}

// ── Helpers ────────────────────────────────────────────────────────────

function getFreshnessStatus(days: number): { status: string; emoji: string } {
  if (days <= FRESH_THRESHOLD) return { status: "Fresh", emoji: "🟢" };
  if (days <= WARM_THRESHOLD) return { status: "Warm", emoji: "🟡" };
  if (days <= COOLING_THRESHOLD) return { status: "Cooling", emoji: "🟠" };
  if (days <= STALE_THRESHOLD) return { status: "Stale", emoji: "🔴" };
  return { status: "Dormant", emoji: "⚫" };
}

function daysBetween(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().split("T")[0];
}

function lookupName(identifier: string): string {
  return KNOWN_CONTACTS[identifier] || identifier;
}

// ── Data Fetching ─────────────────────────────────────────────────────

async function fetchAllIMessages(
  sb: ReturnType<typeof createClient<unknown>>,
): Promise<IMessage[]> {
  const all: IMessage[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from("imessage_messages")
      .select("id, phone, text, ts, direction")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching iMessages:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    all.push(...(data as IMessage[]));
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return all;
}

async function fetchAllEmails(
  sb: ReturnType<typeof createClient<unknown>>,
): Promise<EmailMessage[]> {
  const all: EmailMessage[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from("email_messages")
      .select("id, from_email, to_email, received_at, subject")
      .order("received_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Error fetching emails:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    all.push(...(data as EmailMessage[]));
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return all;
}

// ── Aggregation ───────────────────────────────────────────────────────

function aggregateIMessages(messages: IMessage[], now: Date): ContactStats[] {
  const byPhone = new Map<
    string,
    {
      total: number;
      inbound: number;
      outbound: number;
      firstTs: Date | null;
      lastTs: Date | null;
    }
  >();

  for (const msg of messages) {
    const phone = (msg.phone || "").trim();
    if (!phone || phone === "test") continue;

    const existing = byPhone.get(phone) || {
      total: 0,
      inbound: 0,
      outbound: 0,
      firstTs: null,
      lastTs: null,
    };

    existing.total++;
    if (msg.direction === "inbound") existing.inbound++;
    else existing.outbound++;

    if (msg.ts) {
      const ts = new Date(msg.ts);
      if (!existing.firstTs || ts < existing.firstTs) existing.firstTs = ts;
      if (!existing.lastTs || ts > existing.lastTs) existing.lastTs = ts;
    }

    byPhone.set(phone, existing);
  }

  const stats: ContactStats[] = [];
  for (const [phone, data] of byPhone) {
    const days = data.lastTs ? daysBetween(data.lastTs, now) : 9999;
    const { status, emoji } = getFreshnessStatus(days);

    stats.push({
      identifier: phone,
      displayName: lookupName(phone),
      source: "imessage",
      totalMessages: data.total,
      inboundCount: data.inbound,
      outboundCount: data.outbound,
      firstMessageAt: data.firstTs,
      lastMessageAt: data.lastTs,
      daysSinceLastMessage: days,
      freshnessStatus: status,
      freshnessEmoji: emoji,
      responseRatio: data.total > 0 ? data.outbound / data.total : 0,
    });
  }

  return stats;
}

function aggregateEmails(emails: EmailMessage[], now: Date): ContactStats[] {
  // Julian's known emails
  const julianEmails = new Set([
    "julian@aiacrobatics.com",
    "julianb233@gmail.com",
  ]);

  const byEmail = new Map<
    string,
    {
      total: number;
      inbound: number;
      outbound: number;
      firstTs: Date | null;
      lastTs: Date | null;
    }
  >();

  for (const email of emails) {
    // Determine the counterparty email
    const fromClean = (email.from_email || "")
      .replace(/<.*>/, "")
      .trim()
      .toLowerCase();
    const fromAddr = (email.from_email || "").match(/<(.+?)>/)?.[1]?.toLowerCase() || fromClean;
    const toAddr = (email.to_email || "").match(/<(.+?)>/)?.[1]?.toLowerCase() ||
      (email.to_email || "").toLowerCase();

    let counterparty: string;
    let direction: "inbound" | "outbound";

    if (julianEmails.has(fromAddr)) {
      counterparty = toAddr;
      direction = "outbound";
    } else {
      counterparty = fromAddr;
      direction = "inbound";
    }

    if (!counterparty || counterparty.includes("noreply") || counterparty.includes("notifications@")) {
      continue;
    }

    const existing = byEmail.get(counterparty) || {
      total: 0,
      inbound: 0,
      outbound: 0,
      firstTs: null,
      lastTs: null,
    };

    existing.total++;
    if (direction === "inbound") existing.inbound++;
    else existing.outbound++;

    if (email.received_at) {
      const ts = new Date(email.received_at);
      if (!existing.firstTs || ts < existing.firstTs) existing.firstTs = ts;
      if (!existing.lastTs || ts > existing.lastTs) existing.lastTs = ts;
    }

    byEmail.set(counterparty, existing);
  }

  const stats: ContactStats[] = [];
  for (const [emailAddr, data] of byEmail) {
    const days = data.lastTs ? daysBetween(data.lastTs, now) : 9999;
    const { status, emoji } = getFreshnessStatus(days);

    stats.push({
      identifier: emailAddr,
      displayName: lookupName(emailAddr),
      source: "email",
      totalMessages: data.total,
      inboundCount: data.inbound,
      outboundCount: data.outbound,
      firstMessageAt: data.firstTs,
      lastMessageAt: data.lastTs,
      daysSinceLastMessage: days,
      freshnessStatus: status,
      freshnessEmoji: emoji,
      responseRatio: data.total > 0 ? data.outbound / data.total : 0,
    });
  }

  return stats;
}

// ── Markdown Generation ───────────────────────────────────────────────

function generateDashboard(
  imessageStats: ContactStats[],
  emailStats: ContactStats[],
  now: Date,
): string {
  const allStats = [...imessageStats, ...emailStats].sort(
    (a, b) => a.daysSinceLastMessage - b.daysSinceLastMessage,
  );

  // Summary counts
  const freshCount = allStats.filter((s) => s.freshnessStatus === "Fresh").length;
  const warmCount = allStats.filter((s) => s.freshnessStatus === "Warm").length;
  const coolingCount = allStats.filter((s) => s.freshnessStatus === "Cooling").length;
  const staleCount = allStats.filter((s) => s.freshnessStatus === "Stale").length;
  const dormantCount = allStats.filter((s) => s.freshnessStatus === "Dormant").length;

  // Top contacts by volume
  const topByVolume = [...allStats].sort((a, b) => b.totalMessages - a.totalMessages).slice(0, 10);

  // Contacts needing attention (cooling or stale with high volume)
  const needsAttention = allStats
    .filter(
      (s) =>
        (s.freshnessStatus === "Cooling" || s.freshnessStatus === "Stale") &&
        s.totalMessages >= 5,
    )
    .sort((a, b) => b.totalMessages - a.totalMessages);

  let md = "";

  // ── Header ──
  md += `---\ndate: ${now.toISOString().split("T")[0]}\ntype: dashboard\ntags: [reply-like-me, contacts, freshness]\n---\n\n`;
  md += `# 📡 Contact Freshness Dashboard\n\n`;
  md += `> Auto-generated on **${now.toISOString().split("T")[0]}** at ${now.toTimeString().split(" ")[0]} UTC\n`;
  md += `> Sources: ${imessageStats.length} iMessage contacts, ${emailStats.length} email contacts\n\n`;

  // ── Summary Cards ──
  md += `## 📊 Summary\n\n`;
  md += `| Status | Count | Threshold |\n`;
  md += `|--------|-------|-----------|\n`;
  md += `| 🟢 Fresh | ${freshCount} | ≤ ${FRESH_THRESHOLD} days |\n`;
  md += `| 🟡 Warm | ${warmCount} | ≤ ${WARM_THRESHOLD} days |\n`;
  md += `| 🟠 Cooling | ${coolingCount} | ≤ ${COOLING_THRESHOLD} days |\n`;
  md += `| 🔴 Stale | ${staleCount} | ≤ ${STALE_THRESHOLD} days |\n`;
  md += `| ⚫ Dormant | ${dormantCount} | > ${STALE_THRESHOLD} days |\n`;
  md += `| **Total** | **${allStats.length}** | |\n\n`;

  // ── Needs Attention ──
  if (needsAttention.length > 0) {
    md += `## ⚠️ Needs Attention\n\n`;
    md += `Contacts with significant history that are going cold:\n\n`;
    md += `| Contact | Last Message | Days Ago | Messages | Status |\n`;
    md += `|---------|-------------|----------|----------|--------|\n`;
    for (const s of needsAttention.slice(0, 15)) {
      md += `| ${s.displayName} | ${formatDate(s.lastMessageAt)} | ${s.daysSinceLastMessage} | ${s.totalMessages} | ${s.freshnessEmoji} ${s.freshnessStatus} |\n`;
    }
    md += `\n`;
  }

  // ── Top Contacts by Volume ──
  md += `## 🏆 Top Contacts by Volume\n\n`;
  md += `| # | Contact | Source | Total | In | Out | Ratio | Last Message | Status |\n`;
  md += `|---|---------|--------|-------|-----|-----|-------|-------------|--------|\n`;
  for (let i = 0; i < topByVolume.length; i++) {
    const s = topByVolume[i];
    const ratio = `${Math.round(s.responseRatio * 100)}%`;
    md += `| ${i + 1} | ${s.displayName} | ${s.source} | ${s.totalMessages} | ${s.inboundCount} | ${s.outboundCount} | ${ratio} | ${formatDate(s.lastMessageAt)} | ${s.freshnessEmoji} |\n`;
  }
  md += `\n`;

  // ── iMessage Contacts (Full Table) ──
  md += `## 💬 iMessage Contacts\n\n`;
  md += `| Contact | Phone | Total | In ← | Out → | Last Message | Days | Status |\n`;
  md += `|---------|-------|-------|-------|-------|-------------|------|--------|\n`;
  for (const s of imessageStats.sort((a, b) => a.daysSinceLastMessage - b.daysSinceLastMessage)) {
    md += `| ${s.displayName} | ${s.identifier} | ${s.totalMessages} | ${s.inboundCount} | ${s.outboundCount} | ${formatDate(s.lastMessageAt)} | ${s.daysSinceLastMessage === 9999 ? "—" : s.daysSinceLastMessage} | ${s.freshnessEmoji} ${s.freshnessStatus} |\n`;
  }
  md += `\n`;

  // ── Email Contacts (Full Table) ──
  if (emailStats.length > 0) {
    md += `## 📧 Email Contacts\n\n`;
    md += `| Contact | Email | Total | In ← | Out → | Last Message | Days | Status |\n`;
    md += `|---------|-------|-------|-------|-------|-------------|------|--------|\n`;
    for (const s of emailStats.sort((a, b) => a.daysSinceLastMessage - b.daysSinceLastMessage)) {
      md += `| ${s.displayName} | ${s.identifier} | ${s.totalMessages} | ${s.inboundCount} | ${s.outboundCount} | ${formatDate(s.lastMessageAt)} | ${s.daysSinceLastMessage === 9999 ? "—" : s.daysSinceLastMessage} | ${s.freshnessEmoji} ${s.freshnessStatus} |\n`;
    }
    md += `\n`;
  }

  // ── Freshness Distribution ──
  md += `## 📈 Freshness Distribution\n\n`;
  md += `\`\`\`\n`;
  const maxBarLen = 30;
  const maxCount = Math.max(freshCount, warmCount, coolingCount, staleCount, dormantCount, 1);
  const bar = (count: number) => "█".repeat(Math.ceil((count / maxCount) * maxBarLen));
  md += `Fresh    ${bar(freshCount)} ${freshCount}\n`;
  md += `Warm     ${bar(warmCount)} ${warmCount}\n`;
  md += `Cooling  ${bar(coolingCount)} ${coolingCount}\n`;
  md += `Stale    ${bar(staleCount)} ${staleCount}\n`;
  md += `Dormant  ${bar(dormantCount)} ${dormantCount}\n`;
  md += `\`\`\`\n\n`;

  // ── Footer ──
  md += `---\n\n`;
  md += `*Dashboard generated by Reply Like Me — PERS-407*\n`;
  md += `*Run: \`npx tsx scripts/generate-freshness-dashboard.ts\`*\n`;

  return md;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Contact Freshness Dashboard Generator ===\n");

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();

  // Fetch data
  console.log("Fetching iMessages...");
  const iMessages = await fetchAllIMessages(sb);
  console.log(`  ${iMessages.length} iMessages fetched`);

  console.log("Fetching emails...");
  const emails = await fetchAllEmails(sb);
  console.log(`  ${emails.length} emails fetched`);

  // Aggregate
  console.log("\nAggregating contact stats...");
  const imessageStats = aggregateIMessages(iMessages, now);
  const emailStats = aggregateEmails(emails, now);
  console.log(`  ${imessageStats.length} iMessage contacts`);
  console.log(`  ${emailStats.length} email contacts`);

  // Generate markdown
  console.log("\nGenerating dashboard...");
  const markdown = generateDashboard(imessageStats, emailStats, now);

  // Write to Obsidian vault
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, markdown, "utf-8");
  console.log(`\n✅ Dashboard written to: ${OUTPUT_FILE}`);
  console.log(`   ${markdown.split("\n").length} lines, ${markdown.length} bytes`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
