/**
 * Supabase client for Reply Like Me.
 *
 * Connects to the shared Dashboard Daddy Supabase project (jrirksdiklqwsaatbhvg).
 * All rlm_* tables live in this project.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
