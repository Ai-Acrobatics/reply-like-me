/**
 * Supabase Store — Reply Like Me
 *
 * Data access layer for contacts, communication profiles,
 * messages, and draft replies. Powers the reply generation
 * engine and MCP tool interface.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Contact, CommunicationProfile, Message, DraftReply } from "./types.js";

export interface SupabaseStore {
  client: SupabaseClient;
  getContact(id: string): Promise<Contact | null>;
  getContactByPhone(phone: string): Promise<Contact | null>;
  getContactByHandle(handle: string): Promise<Contact | null>;
  getProfile(contactId: string): Promise<CommunicationProfile | null>;
  getRecentMessages(contactId: string, limit?: number): Promise<Message[]>;
  getPendingDrafts(limit?: number): Promise<DraftReply[]>;
  getDraft(id: string): Promise<DraftReply | null>;
  updateDraftStatus(id: string, status: DraftReply["status"], editedBubbles?: string[]): Promise<DraftReply>;
  saveDraft(draft: Omit<DraftReply, "id" | "created_at" | "reviewed_at">): Promise<DraftReply>;
  getDraftStats(): Promise<{
    total: number;
    pending: number;
    accepted: number;
    edited: number;
    rejected: number;
    sent: number;
    acceptanceRate: number;
  }>;
}

export function createSupabaseStore(url: string, key: string): SupabaseStore {
  const client = createClient(url, key, { auth: { persistSession: false } });

  return {
    client,

    async getContact(id: string) {
      const { data } = await client.from("rlm_contacts").select("*").eq("id", id).single();
      return data as Contact | null;
    },

    async getContactByPhone(phone: string) {
      const { data } = await client.from("rlm_contacts").select("*").eq("phone", phone).single();
      return data as Contact | null;
    },

    async getContactByHandle(handle: string) {
      const { data } = await client.from("rlm_contacts").select("*").eq("handle_id", handle).single();
      return data as Contact | null;
    },

    async getProfile(contactId: string) {
      const { data } = await client
        .from("rlm_communication_profiles")
        .select("*")
        .eq("contact_id", contactId)
        .single();
      return data as CommunicationProfile | null;
    },

    async getRecentMessages(contactId: string, limit = 50) {
      const { data } = await client
        .from("rlm_messages")
        .select("*")
        .eq("contact_id", contactId)
        .order("timestamp", { ascending: false })
        .limit(limit);
      return (data ?? []) as Message[];
    },

    async getPendingDrafts(limit = 20) {
      const { data } = await client
        .from("rlm_draft_replies")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []) as DraftReply[];
    },

    async getDraft(id: string) {
      const { data } = await client.from("rlm_draft_replies").select("*").eq("id", id).single();
      return data as DraftReply | null;
    },

    async updateDraftStatus(id: string, status: DraftReply["status"], editedBubbles?: string[]) {
      const update: Record<string, unknown> = { status, reviewed_at: new Date().toISOString() };
      if (editedBubbles) update.edited_bubbles = editedBubbles;

      const { data, error } = await client
        .from("rlm_draft_replies")
        .update(update)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data as DraftReply;
    },

    async saveDraft(draft) {
      const { data, error } = await client
        .from("rlm_draft_replies")
        .insert(draft)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data as DraftReply;
    },

    async getDraftStats() {
      const { count: total } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true });

      const { count: accepted } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true })
        .eq("status", "accepted");

      const { count: edited } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true })
        .eq("status", "edited");

      const { count: rejected } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true })
        .eq("status", "rejected");

      const { count: sent } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent");

      const { count: pending } = await client
        .from("rlm_draft_replies")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");

      const t = total ?? 0;
      const a = (accepted ?? 0) + (edited ?? 0) + (sent ?? 0);

      return {
        total: t,
        pending: pending ?? 0,
        accepted: accepted ?? 0,
        edited: edited ?? 0,
        rejected: rejected ?? 0,
        sent: sent ?? 0,
        acceptanceRate: t > 0 ? a / t : 0,
      };
    },
  };
}
