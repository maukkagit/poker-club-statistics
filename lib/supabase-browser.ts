"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, used ONLY for Realtime broadcast subscriptions on
 * the public tournament-clock channel. It uses the anon (publishable) key —
 * never the service-role key — and is memoised so we keep a single websocket.
 *
 * Returns null when the public env vars aren't configured, in which case
 * callers degrade gracefully to SWR polling. Setting these is optional:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
let _client: SupabaseClient | null | undefined;

export function browserSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _client = url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return _client;
}
