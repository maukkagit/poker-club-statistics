// Core persisted domain entities (the shapes that map onto DB rows) plus the
// derived ComputedEntry. Stats/aggregation and API-response shapes live in
// their own sibling modules; import everything from "@/lib/types".

export type Player = { id: string; name: string; created_at: string };

export type Location = { id: string; name: string; created_at: string };

/**
 * One message in a tournament's public chat (table `chat_messages`). Posted by
 * anyone holding the share-token viewer link, under a self-chosen display name.
 * Exactly one message per tournament may be `pinned` at a time.
 */
export type ChatMessage = {
  id: string;
  tournament_id: string;
  author_name: string;
  body: string;
  pinned: boolean;
  created_at: string; // ISO timestamp
};

export type PayoutSlot = { position: number; pct: number };

/**
 * Tournament lifecycle state.
 * - "Active": the tournament is in progress / being tracked live. It is
 *   excluded from every stats / series / summary aggregation and shown in a
 *   dedicated "Active tournaments" section on the list page.
 * - "Finished": the tournament's results are final. It contributes to all
 *   stats and is what we count in the player leaderboards & summaries.
 *
 * Legacy rows imported before this column existed are treated as "Finished"
 * by `tParse` so historic data continues to feed the stats pipeline.
 */
export type TournamentState = "Active" | "Finished";

/**
 * Persisted seat-draw metadata for a tournament (jsonb column `seating`).
 * Absent/empty until a draw is confirmed. The per-player seat assignment lives
 * on `entries.table_no/seat_no`; this object holds the table-level shape and
 * the button position (per table) that blinds are derived from.
 */
export type Seating = {
  tables: number;
  seats_per_table: number;   // capacity / rebalance threshold, capped at 10
  buckets_used: boolean;
  // Button seat_no per table, keyed by table number as a string (jsonb keys
  // are always strings). e.g. { "1": 3 } = seat 3 on table 1 has the button.
  buttons: Record<string, number>;
  drawn_at: string;          // ISO timestamp of the (re)draw
};

/**
 * One row of a tournament's clock structure (jsonb column `structure`). Either
 * a blind level or a break. Ordered: the array index is play order.
 */
export type BlindLevel = {
  kind: "level";
  sb: number;            // small blind
  bb: number;            // big blind
  ante: number;          // big-blind ante (0 = none)
  duration_min: number;  // level length in minutes
};
export type BreakRow = {
  kind: "break";
  duration_min: number;  // break length in minutes
};
export type StructureRow = BlindLevel | BreakRow;

/**
 * Single-counter clock state (jsonb column `clock`). `elapsed_ms` is the total
 * elapsed across the WHOLE structure as of `updated_at`; while `running`, the
 * live value is `elapsed_ms + (now - updated_at)`. The current level/break,
 * time remaining and "next level" are all derived from `structure` + this
 * counter (see `lib/tournament-clock.ts`), so there's no per-level state to
 * keep in sync. Never auto-started: `started` flips when the director presses
 * Start.
 */
export type TournamentClock = {
  started: boolean;
  running: boolean;
  elapsed_ms: number;
  updated_at: string | null; // ISO timestamp of the last counter stamp
};

export type Tournament = {
  id: string;
  date: string;            // ISO date (yyyy-mm-dd)
  name: string;
  buy_in_amount: number;   // EUR per buy-in
  payout_structure: PayoutSlot[]; // e.g. [{position:1,pct:60}, ...] must sum to 100
  notes?: string;
  // FK into the Locations table. `null` means "no location recorded" — used
  // for legacy tournaments imported before locations existed.
  location_id?: string | null;
  state: TournamentState;
  // ---- Live-tournament fields (issue #20) ----
  // Seat-draw metadata; null until seats are drawn. Re-draws overwrite it.
  seating?: Seating | null;
  // Whether rebuys are permitted at all for this tournament. Decided in the
  // wizard's Step 1 and immutable afterwards. Defaults to true.
  rebuys_allowed?: boolean;
  // Director-controlled flag flipped live to open/close the rebuy period.
  // Only meaningful (and editable) when `rebuys_allowed`. "Rebuys active" =
  // rebuys_allowed && rebuy_window_open.
  rebuy_window_open?: boolean;
  // Optimistic-concurrency counter bumped by every RPC mutation. The client
  // passes the version it last saw; a mismatch surfaces a conflict.
  version?: number;
  // "Make a deal" overrides: map of finishing position -> euro amount that
  // overrides the percentage split for that position. Keyed by position as a
  // string (jsonb keys are strings). Null/absent until a deal is struck; a
  // per-entry payout_override still wins over it.
  payout_overrides?: Record<string, number> | null;
  // "Special" tournaments are off-format events (themed nights, charity
  // games, etc.). They live alongside regular tournaments but are excluded
  // by default from every dashboard aggregation; a toggle on the dashboard
  // lets the user opt into including them. Legacy rows imported before this
  // column existed are parsed as `false`.
  special: boolean;
  // Server-stamped ISO timestamp set on creation. Used as a tiebreaker when
  // sorting tournaments that share the same `date` (since `date` is day
  // granularity). Never settable from the client. Legacy rows missing this
  // value are backfilled deterministically in current sheet order so
  // existing display order is preserved.
  created_at: string;
  // ---- Tournament clock (issue #21) ----
  // Blind/break structure chosen in the wizard's Structure step. Empty array
  // (or absent) means no clock was configured for this tournament.
  structure?: StructureRow[];
  // Starting chip stack per buy-in. Used to derive chips in play / average
  // stack on the clock. Null/absent when not configured.
  starting_stack?: number | null;
  // Single-counter clock state; null until the structure exists. Never
  // auto-starts.
  clock?: TournamentClock | null;
  // Random public handle for the read-only viewer link (`/clock/{token}`).
  share_token?: string | null;
};

export type Entry = {
  id: string;
  tournament_id: string;
  player_id: string;
  buy_ins: number;         // includes rebuys / re-entries
  finish_position: number | null; // null = no finish recorded
  payout_override: number | null; // EUR; if set wins over computed
  // ---- Live seating fields (issue #20) ----
  // Current seat. Both null (not seated / busted) or both set (CHECK enforced).
  // `seat_no` is a 1..N gapless index among a table's current occupants.
  table_no?: number | null;
  seat_no?: number | null;
  // Optional performance tier for a bucket-seeded draw; persisted so re-draws
  // keep the same tiers. Any positive integer; uneven bucket sizes are fine.
  bucket?: number | null;
};

export type ComputedEntry = Entry & {
  payout: number;          // EUR awarded (override or computed)
  cost: number;            // buy_ins * buy_in_amount
  net: number;             // payout - cost
};
