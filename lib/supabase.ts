import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * Uses the service-role key, so it bypasses Row Level Security. This is only
 * ever imported by API routes / scripts that run on the server — never shipped
 * to the browser. The app's own password auth (see `middleware.ts`) gates every
 * request before it reaches a route, so we don't rely on RLS for access control.
 *
 * The client is memoised across invocations (and across hot reloads in dev) so
 * we don't spin up a new connection pool per request.
 */
let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js issues its requests through the global `fetch`, which the
    // Next.js App Router patches to cache GET responses in its Data Cache by
    // default. For a database client that's wrong — a cached read can serve a
    // stale row indefinitely (e.g. the public clock viewer kept seeing a
    // not-started clock after the director started it). Force `no-store` so
    // every DB read hits Postgres fresh.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return _client;
}
