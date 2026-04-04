import { config } from "../config.js";
import {
  fetchUnprocessedMessages,
  insertClassifications,
  fetchClassifiedMessages,
  upsertProfile,
  getRecentlyClassifiedContactIds,
} from "../db/supabase.js";
import { healthCheck } from "../ollama/client.js";
import { classifyBatch } from "./classifier.js";
import { buildProfile } from "./profiler.js";
import type { PipelineResult } from "../types/index.js";

/**
 * Run the full message processing pipeline:
 * 1. Fetch unprocessed messages from Supabase
 * 2. Classify each via Ollama
 * 3. Store classifications
 * 4. Rebuild communication profiles for affected contacts
 */
export async function runPipeline(): Promise<PipelineResult> {
  const start = Date.now();
  const errors: string[] = [];

  // Step 0: Health check Ollama
  console.log("Checking Ollama availability...");
  const health = await healthCheck();
  if (!health.ok) {
    return {
      messagesProcessed: 0,
      classificationsCreated: 0,
      profilesUpdated: 0,
      errors: [`Ollama health check failed: ${health.error}`],
      durationMs: Date.now() - start,
    };
  }
  console.log(`Ollama OK — using model: ${health.model}`);

  // Step 1: Fetch unprocessed messages
  console.log(
    `\nFetching up to ${config.pipeline.batchSize} unprocessed messages...`
  );
  const messages = await fetchUnprocessedMessages(config.pipeline.batchSize);
  console.log(`Found ${messages.length} unprocessed messages`);

  if (messages.length === 0) {
    return {
      messagesProcessed: 0,
      classificationsCreated: 0,
      profilesUpdated: 0,
      errors: [],
      durationMs: Date.now() - start,
    };
  }

  // Step 2: Classify messages via Ollama
  console.log("\nClassifying messages via Ollama...");
  const classifications = await classifyBatch(messages);
  console.log(`Classified ${classifications.length}/${messages.length} messages`);

  // Step 3: Store classifications
  if (classifications.length > 0) {
    console.log("\nStoring classifications in Supabase...");
    try {
      const inserted = await insertClassifications(classifications);
      console.log(`Stored ${inserted} classifications`);
    } catch (err) {
      const msg = `Failed to store classifications: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  // Step 4: Rebuild profiles for affected contacts
  console.log("\nRebuilding communication profiles...");
  const contactIds = [
    ...new Set(
      messages
        .filter((m) => m.contact_id)
        .map((m) => m.contact_id as string)
    ),
  ];

  let profilesUpdated = 0;
  for (const contactId of contactIds) {
    try {
      const contactMessages = await fetchClassifiedMessages(
        contactId,
        config.pipeline.profileWindowDays
      );

      const profile = await buildProfile(contactId, contactMessages);
      if (profile) {
        await upsertProfile(profile);
        profilesUpdated++;
        console.log(
          `  Updated profile for ${contactId} (${profile.sample_count} samples, formality: ${profile.formality_score}/10)`
        );
      }
    } catch (err) {
      const msg = `Profile build failed for ${contactId}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`  ${msg}`);
    }
  }

  const result: PipelineResult = {
    messagesProcessed: messages.length,
    classificationsCreated: classifications.length,
    profilesUpdated,
    errors,
    durationMs: Date.now() - start,
  };

  console.log(
    `\nPipeline complete in ${(result.durationMs / 1000).toFixed(1)}s — ` +
      `${result.classificationsCreated} classified, ${result.profilesUpdated} profiles updated` +
      (errors.length > 0 ? `, ${errors.length} errors` : "")
  );

  return result;
}

/**
 * Rebuild all communication profiles (full refresh).
 * Useful for initial setup or after schema changes.
 */
export async function rebuildAllProfiles(): Promise<{
  profilesUpdated: number;
  errors: string[];
}> {
  console.log("Rebuilding ALL communication profiles...");
  const errors: string[] = [];
  let profilesUpdated = 0;

  const contactIds = await getRecentlyClassifiedContactIds();
  console.log(`Found ${contactIds.length} contacts with classified messages`);

  for (const contactId of contactIds) {
    try {
      const messages = await fetchClassifiedMessages(
        contactId,
        config.pipeline.profileWindowDays
      );
      const profile = await buildProfile(contactId, messages);
      if (profile) {
        await upsertProfile(profile);
        profilesUpdated++;
        console.log(
          `  [${profilesUpdated}/${contactIds.length}] ${contactId}: ` +
            `${profile.sample_count} msgs, formality ${profile.formality_score}/10, ` +
            `style: ${profile.message_style}`
        );
      }
    } catch (err) {
      const msg = `${contactId}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`  ERROR: ${msg}`);
    }
  }

  console.log(
    `\nDone — ${profilesUpdated} profiles updated, ${errors.length} errors`
  );
  return { profilesUpdated, errors };
}
