/**
 * Profile Generator — Reply Like Me
 *
 * Orchestrates per-contact NLP communication profile generation.
 * Combines text analysis + cadence analysis + optional LLM summary.
 *
 * Usage:
 *   import { generateProfile } from "./profiler/index.js";
 *   const profile = await generateProfile(contactId, messages, { useLlm: true });
 *
 * Or use generateProfileFromSupabase() to auto-fetch messages.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RlmMessage, RlmStyleProfile } from "../types/index.js";
import { analyzeTexts, type TextAnalysisResult } from "./text-analyzer.js";
import { analyzeCadence, type CadenceAnalysisResult, type HourlyPattern } from "./cadence-analyzer.js";
import { generateStyleSummary, analyzeTopics, type OllamaConfig } from "./ollama.js";

// ─── Types ────────────────────────────────────────────────────────

export interface ProfileGenerationOptions {
  useLlm?: boolean; // default true — call Ollama for style summary + topics
  ollamaConfig?: OllamaConfig;
  maxMessages?: number; // max messages to analyze (default 2000)
}

export interface GeneratedProfile {
  text_analysis: TextAnalysisResult;
  cadence_analysis: CadenceAnalysisResult;
  style_summary: string | null; // LLM-generated description
  topic_distribution: Record<string, number> | null;
  model_version: string;
}

export interface ProfileUpsertData {
  profile: Omit<RlmStyleProfile, "id" | "created_at" | "updated_at">;
  cadence_patterns: HourlyPattern[];
}

const MODEL_VERSION = "v0.1.0";

// ─── Core Profile Generation ───────────────────────────────────────

/**
 * Generate a full communication profile from a list of messages.
 * This is the pure function — no Supabase dependency.
 */
export async function generateProfile(
  contactName: string,
  relationshipType: string | null,
  messages: RlmMessage[],
  options: ProfileGenerationOptions = {}
): Promise<GeneratedProfile> {
  const { useLlm = true, ollamaConfig } = options;

  // Run text and cadence analysis (pure, synchronous)
  const textAnalysis = analyzeTexts(messages);
  const cadenceAnalysis = analyzeCadence(messages);

  // Collect sample messages for LLM
  const julianTexts = messages
    .filter((m) => m.is_from_julian && m.text_content && !m.is_reaction)
    .sort((a, b) => new Date(b.date_utc).getTime() - new Date(a.date_utc).getTime())
    .slice(0, 50)
    .map((m) => m.text_content!);

  // LLM-assisted analysis (optional, graceful fallback)
  let styleSummary: string | null = null;
  let topicDistribution: Record<string, number> | null = null;

  if (useLlm && julianTexts.length >= 10) {
    // Run both LLM tasks concurrently
    const [summary, topics] = await Promise.all([
      generateStyleSummary(
        {
          contact_name: contactName,
          relationship_type: relationshipType,
          formality_score: textAnalysis.formality_score,
          avg_message_length: textAnalysis.avg_message_length,
          emoji_frequency: textAnalysis.emoji_frequency,
          top_emojis: textAnalysis.top_emojis,
          abbreviation_frequency: textAnalysis.abbreviation_frequency,
          common_abbreviations: textAnalysis.common_abbreviations,
          greeting_patterns: textAnalysis.greeting_patterns,
          signoff_patterns: textAnalysis.signoff_patterns,
          humor_frequency: textAnalysis.humor_frequency,
          sentiment_baseline: textAnalysis.sentiment_baseline,
          messages_per_burst: cadenceAnalysis.messages_per_burst,
          avg_response_time_seconds: cadenceAnalysis.avg_response_time_seconds,
          sample_messages: julianTexts,
        },
        ollamaConfig
      ),
      analyzeTopics(contactName, julianTexts, ollamaConfig),
    ]);

    styleSummary = summary;
    topicDistribution = topics;
  }

  return {
    text_analysis: textAnalysis,
    cadence_analysis: cadenceAnalysis,
    style_summary: styleSummary,
    topic_distribution: topicDistribution,
    model_version: MODEL_VERSION,
  };
}

// ─── Supabase Integration ──────────────────────────────────────────

/**
 * Fetch messages from Supabase and generate a profile for a contact.
 */
export async function generateProfileFromSupabase(
  supabase: SupabaseClient,
  contactId: string,
  options: ProfileGenerationOptions = {}
): Promise<GeneratedProfile | null> {
  const maxMessages = options.maxMessages ?? 2000;

  // Fetch contact info
  const { data: contact, error: contactErr } = await supabase
    .from("rlm_contacts")
    .select("display_name, relationship_type")
    .eq("id", contactId)
    .single();

  if (contactErr || !contact) {
    console.error(`Contact ${contactId} not found: ${contactErr?.message}`);
    return null;
  }

  // Fetch messages (most recent N)
  const { data: messages, error: msgErr } = await supabase
    .from("rlm_messages")
    .select("*")
    .eq("contact_id", contactId)
    .eq("is_group_chat", false)
    .order("date_utc", { ascending: false })
    .limit(maxMessages);

  if (msgErr) {
    console.error(`Failed to fetch messages: ${msgErr.message}`);
    return null;
  }

  if (!messages || messages.length === 0) {
    console.error(`No messages found for contact ${contactId}`);
    return null;
  }

  return generateProfile(
    contact.display_name ?? "Unknown",
    contact.relationship_type,
    messages as RlmMessage[],
    options
  );
}

/**
 * Generate profile and write results back to Supabase.
 * Upserts rlm_style_profiles and rlm_cadence_patterns.
 */
export async function generateAndSaveProfile(
  supabase: SupabaseClient,
  contactId: string,
  options: ProfileGenerationOptions = {}
): Promise<ProfileUpsertData | null> {
  const result = await generateProfileFromSupabase(supabase, contactId, options);
  if (!result) return null;

  const { text_analysis: ta, cadence_analysis: ca } = result;

  const profileData: ProfileUpsertData["profile"] = {
    contact_id: contactId,
    formality_score: ta.formality_score,
    sentiment_baseline: ta.sentiment_baseline,
    humor_frequency: ta.humor_frequency,
    sarcasm_frequency: null, // requires LLM — future enhancement
    avg_message_length: ta.avg_message_length,
    avg_words_per_message: ta.avg_words_per_message,
    messages_per_burst: ca.messages_per_burst,
    burst_threshold_seconds: ca.burst_threshold_seconds,
    single_vs_multi_ratio: ca.single_vs_multi_ratio,
    emoji_frequency: ta.emoji_frequency,
    top_emojis: ta.top_emojis,
    exclamation_frequency: ta.exclamation_frequency,
    question_frequency: ta.question_frequency,
    caps_usage: ta.caps_usage,
    greeting_patterns: ta.greeting_patterns,
    signoff_patterns: ta.signoff_patterns,
    abbreviation_frequency: ta.abbreviation_frequency,
    common_abbreviations: ta.common_abbreviations,
    slang_terms: ta.slang_terms,
    topic_distribution: result.topic_distribution,
    avg_response_time_seconds: ca.avg_response_time_seconds,
    response_time_p50: ca.response_time_p50,
    response_time_p90: ca.response_time_p90,
    active_hours: ca.active_hours,
    active_days: ca.active_days,
    sample_size: ta.sample_size,
    last_analyzed_at: new Date().toISOString(),
    model_version: result.model_version,
  };

  // Upsert style profile (one per contact)
  const { error: profileErr } = await supabase
    .from("rlm_style_profiles")
    .upsert(
      { ...profileData, updated_at: new Date().toISOString() },
      { onConflict: "contact_id" }
    );

  if (profileErr) {
    console.error(`Failed to upsert profile: ${profileErr.message}`);
    return null;
  }

  // Delete old cadence patterns and insert new
  if (ca.hourly_patterns.length > 0) {
    await supabase.from("rlm_cadence_patterns").delete().eq("contact_id", contactId);

    const cadenceRows = ca.hourly_patterns.map((p) => ({
      contact_id: contactId,
      ...p,
    }));

    const { error: cadenceErr } = await supabase
      .from("rlm_cadence_patterns")
      .insert(cadenceRows);

    if (cadenceErr) {
      console.error(`Failed to insert cadence patterns: ${cadenceErr.message}`);
    }
  }

  return {
    profile: profileData,
    cadence_patterns: ca.hourly_patterns,
  };
}

// ─── Batch Processing ──────────────────────────────────────────────

/**
 * Generate profiles for multiple contacts.
 * Processes sequentially to avoid overwhelming Ollama.
 */
export async function generateProfilesBatch(
  supabase: SupabaseClient,
  contactIds: string[],
  options: ProfileGenerationOptions = {},
  onProgress?: (contactId: string, index: number, total: number) => void
): Promise<Map<string, ProfileUpsertData | null>> {
  const results = new Map<string, ProfileUpsertData | null>();

  for (let i = 0; i < contactIds.length; i++) {
    const contactId = contactIds[i];
    onProgress?.(contactId, i, contactIds.length);

    try {
      const result = await generateAndSaveProfile(supabase, contactId, options);
      results.set(contactId, result);
    } catch (err) {
      console.error(`Profile generation failed for ${contactId}: ${(err as Error).message}`);
      results.set(contactId, null);
    }
  }

  return results;
}

// Re-export sub-modules
export { analyzeTexts, type TextAnalysisResult } from "./text-analyzer.js";
export { analyzeCadence, type CadenceAnalysisResult } from "./cadence-analyzer.js";
export { generateStyleSummary, analyzeTopics } from "./ollama.js";
