// Shared (isomorphic) constants for the realtime tournament-clock channel.
// Kept separate from lib/realtime.ts so the browser subscription hook can
// import these without pulling in the server-only Supabase client.

/** Realtime channel topic a clock viewer subscribes to, keyed by share token. */
export const clockChannel = (token: string) => `clock:${token}`;

/** Broadcast event name carrying "the clock/standings changed, refetch". */
export const CLOCK_EVENT = "changed";
