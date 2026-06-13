/**
 * Data-access layer (Supabase / Postgres) — public barrel.
 *
 * The implementation is split across `lib/db/*` modules (mappers, players,
 * locations, tournaments, entries, live-rpc, stats). This barrel re-exports
 * the same public surface so existing `@/lib/db` imports keep working
 * unchanged. The schema lives in `supabase/migrations/0001_init.sql`.
 *
 * Conventions:
 *  - All reads exclude soft-deleted rows (`deleted_at is null`).
 *  - User-facing deletes are soft (set `deleted_at`); a deleted tournament also
 *    soft-deletes its entries. `replaceEntriesFor` hard-deletes the entry set it
 *    is replacing, since that's an edit-time sync, not a user "delete".
 *
 * Note: HTTP error mapping for RPC failures now lives in
 * `@/lib/http/rpc-errors` (`rpcErrorResponse`), not here.
 */
export * from "./db/players";
export * from "./db/locations";
export * from "./db/tournaments";
export * from "./db/entries";
export * from "./db/live-rpc";
export * from "./db/stats";
export * from "./db/chat";
