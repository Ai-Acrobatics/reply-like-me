/**
 * Obsidian vault reader for Reply Like Me.
 * Reads per-contact relationship summaries from the shared Obsidian vault.
 *
 * Path pattern:
 *   /opt/agency-workspace/obsidian-vault/Reply-Like-Me/Contacts/{Name}.md
 *
 * Falls back to checking People/ and Contacts/ subfolders.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
// ─── Types (inline to avoid circular dependency) ─────────────

export interface ObsidianContactSummary {
  handle: string;
  name: string;
  relationship: string;
  formality: string;
  last_updated: string;
  style_summary: string;
  key_topics: string[];
  patterns: string[];
  sample_exchanges: string;
}

const OBSIDIAN_BASE = "/opt/agency-workspace/obsidian-vault";

const SEARCH_PATHS = [
  (name: string) => join(OBSIDIAN_BASE, "Reply-Like-Me", "Contacts", `${name}.md`),
  (name: string) => join(OBSIDIAN_BASE, "People", `${name}.md`),
  (name: string) => join(OBSIDIAN_BASE, "Contacts", `${name}.md`),
];

const SEARCH_DIRS = [
  join(OBSIDIAN_BASE, "Reply-Like-Me", "Contacts"),
  join(OBSIDIAN_BASE, "People"),
  join(OBSIDIAN_BASE, "Contacts"),
];

/**
 * Read a contact's Obsidian relationship summary.
 * Tries multiple vault paths. Returns null if no profile found.
 */
export async function readObsidianProfile(
  contactName: string,
): Promise<string | null> {
  // Sanitize name for filesystem
  const safeName = contactName.replace(/[/\\:*?"<>|]/g, "-").trim();

  for (const pathFn of SEARCH_PATHS) {
    try {
      const content = await readFile(pathFn(safeName), "utf-8");
      return content;
    } catch {
      // File doesn't exist at this path, try next
    }
  }

  return null;
}

// ─── Markdown → Structured Summary ───────────────────────────

/**
 * Parse an Obsidian contact markdown file into a structured summary.
 * Extracts YAML frontmatter and key sections.
 */
function parseContactMarkdown(raw: string, contactName: string): ObsidianContactSummary {
  const lines = raw.split("\n");

  // Extract frontmatter values
  const frontmatter: Record<string, string> = {};
  let inFrontmatter = false;
  let frontmatterEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        frontmatterEnd = i + 1;
        break;
      }
    }
    if (inFrontmatter) {
      const match = lines[i].match(/^(\w[\w_-]*):\s*(.+)$/);
      if (match) {
        frontmatter[match[1]] = match[2].trim();
      }
    }
  }

  const body = lines.slice(frontmatterEnd).join("\n");

  // Extract sections by headers
  const sectionPattern = /^##\s+(.+)$/gm;
  const sections: Record<string, string> = {};
  let match: RegExpExecArray | null;
  const sectionStarts: { name: string; index: number }[] = [];

  while ((match = sectionPattern.exec(body)) !== null) {
    sectionStarts.push({ name: match[1].trim().toLowerCase(), index: match.index + match[0].length });
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].index;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index - sectionStarts[i + 1].name.length - 4 : body.length;
    sections[sectionStarts[i].name] = body.slice(start, end).trim();
  }

  // Extract bullet lists from sections
  function extractBullets(text: string | undefined): string[] {
    if (!text) return [];
    return text
      .split("\n")
      .filter((l) => l.match(/^\s*[-*]\s+/))
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
  }

  return {
    handle: frontmatter.handle ?? contactName,
    name: frontmatter.name ?? contactName,
    relationship: frontmatter.relationship ?? frontmatter.type ?? "unknown",
    formality: frontmatter.formality ?? "unknown",
    last_updated: frontmatter.last_updated ?? frontmatter.date ?? "unknown",
    style_summary:
      sections["style summary"] ??
      sections["style"] ??
      sections["summary"] ??
      body.slice(0, 500),
    key_topics: extractBullets(sections["key topics"] ?? sections["topics"]),
    patterns: extractBullets(sections["patterns"] ?? sections["communication patterns"]),
    sample_exchanges: sections["sample exchanges"] ?? sections["examples"] ?? "",
  };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Get a structured contact summary from Obsidian.
 * Reads the raw markdown and parses it into ObsidianContactSummary.
 */
export async function getContactSummary(
  contactName: string,
): Promise<ObsidianContactSummary | null> {
  const raw = await readObsidianProfile(contactName);
  if (!raw) return null;
  return parseContactMarkdown(raw, contactName);
}

/**
 * Search all contact summaries in Obsidian for matching text.
 * Returns summaries where the raw content matches the query (case-insensitive).
 */
export async function searchContactSummaries(
  query: string,
): Promise<ObsidianContactSummary[]> {
  const results: ObsidianContactSummary[] = [];
  const lowerQuery = query.toLowerCase();

  for (const dir of SEARCH_DIRS) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue; // Directory doesn't exist
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(join(dir, file), "utf-8");
        if (content.toLowerCase().includes(lowerQuery)) {
          const name = basename(file, ".md");
          results.push(parseContactMarkdown(content, name));
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results;
}
