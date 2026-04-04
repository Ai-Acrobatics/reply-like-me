import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type {
  MessageRow,
  MessageClassificationRow,
  CommunicationProfile,
} from "../types/index.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey);
  }
  return client;
}

/**
 * Fetch unprocessed messages (no entry in message_classifications).
 * Returns up to `limit` messages ordered by timestamp ASC.
 */
export async function fetchUnprocessedMessages(
  limit: number
): Promise<MessageRow[]> {
  const sb = getSupabase();

  // Get IDs of already-classified messages
  const { data: classified } = await sb
    .from("message_classifications")
    .select("message_id");

  const classifiedIds = new Set(
    (classified ?? []).map((r: { message_id: string }) => r.message_id)
  );

  // Get messages with actual text content
  const { data: messages, error } = await sb
    .from("messages")
    .select("*")
    .not("text", "is", null)
    .neq("text", "")
    .order("timestamp", { ascending: true })
    .limit(limit * 2); // fetch extra to filter out classified ones

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);

  return (messages ?? [])
    .filter((m: MessageRow) => !classifiedIds.has(m.id))
    .slice(0, limit);
}

/**
 * Fetch all messages for a specific contact within a time window.
 */
export async function fetchContactMessages(
  contactId: string,
  windowDays: number
): Promise<MessageRow[]> {
  const sb = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("contact_id", contactId)
    .not("text", "is", null)
    .neq("text", "")
    .gte("timestamp", since.toISOString())
    .order("timestamp", { ascending: true });

  if (error)
    throw new Error(`Failed to fetch contact messages: ${error.message}`);
  return data ?? [];
}

/**
 * Insert a batch of message classifications.
 */
export async function insertClassifications(
  classifications: MessageClassificationRow[]
): Promise<number> {
  if (classifications.length === 0) return 0;

  const sb = getSupabase();
  const { error, count } = await sb
    .from("message_classifications")
    .insert(classifications, { count: "exact" });

  if (error)
    throw new Error(`Failed to insert classifications: ${error.message}`);
  return count ?? classifications.length;
}

/**
 * Upsert a communication profile for a contact.
 */
export async function upsertProfile(
  profile: CommunicationProfile
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("communication_profiles").upsert(
    {
      ...profile,
      topic_distribution: profile.topic_distribution,
      common_emojis: profile.common_emojis,
      greeting_patterns: profile.greeting_patterns,
      signoff_patterns: profile.signoff_patterns,
      slang_terms: profile.slang_terms,
      active_hours: profile.active_hours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contact_id" }
  );

  if (error) throw new Error(`Failed to upsert profile: ${error.message}`);
}

/**
 * Get distinct contact IDs from recently classified messages.
 */
export async function getRecentlyClassifiedContactIds(): Promise<string[]> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("message_classifications")
    .select("message_id")
    .order("processed_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(`Failed to fetch classified IDs: ${error.message}`);
  if (!data?.length) return [];

  const messageIds = data.map((r: { message_id: string }) => r.message_id);
  const { data: messages } = await sb
    .from("messages")
    .select("contact_id")
    .in("id", messageIds)
    .not("contact_id", "is", null);

  const ids = new Set(
    (messages ?? []).map((m: { contact_id: string }) => m.contact_id)
  );
  return [...ids];
}

/**
 * Fetch classified messages with their classification data for a contact.
 */
export async function fetchClassifiedMessages(
  contactId: string,
  windowDays: number
): Promise<
  Array<MessageRow & { classification: MessageClassificationRow | null }>
> {
  const sb = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data: messages, error } = await sb
    .from("messages")
    .select("*")
    .eq("contact_id", contactId)
    .not("text", "is", null)
    .neq("text", "")
    .gte("timestamp", since.toISOString())
    .order("timestamp", { ascending: true });

  if (error)
    throw new Error(`Failed to fetch contact messages: ${error.message}`);

  if (!messages?.length) return [];

  const messageIds = messages.map((m: MessageRow) => m.id);
  const { data: classifications } = await sb
    .from("message_classifications")
    .select("*")
    .in("message_id", messageIds);

  const classMap = new Map(
    (classifications ?? []).map((c: MessageClassificationRow) => [
      c.message_id,
      c,
    ])
  );

  return messages.map((m: MessageRow) => ({
    ...m,
    classification: classMap.get(m.id) ?? null,
  }));
}

/**
 * Get an existing communication profile for a contact.
 */
export async function getProfile(
  contactId: string
): Promise<CommunicationProfile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("communication_profiles")
    .select("*")
    .eq("contact_id", contactId)
    .limit(1)
    .single();

  if (error?.code === "PGRST116") return null; // not found
  if (error) throw new Error(`Failed to fetch profile: ${error.message}`);
  return data;
}
