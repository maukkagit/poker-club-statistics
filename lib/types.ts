export type Player = { id: string; name: string; created_at: string };

export type Location = { id: string; name: string; created_at: string };

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

export type PlayerStats = {
  player_id: string;
  name: string;
  tournaments: number;
  total_buy_ins: number;
  total_cost: number;
  total_winnings: number;
  net_profit: number;
  avg_net: number;
  // Number of tournaments where the player's computed payout was > 0
  // (i.e. they cashed). itm_rate = itm_count / tournaments.
  itm_count: number;
};

export const TOURNAMENT_FILTER_DEFAULTS = {
  includeSpecial: false,
} as const;

export type TournamentFilter = {
  /**
   * When `false` (default), tournaments with `special === true` are excluded
   * from every aggregation. When `true`, specials are included alongside
   * regular tournaments. Set by the dashboard's "Include special tournaments"
   * toggle.
   */
  includeSpecial?: boolean;
};

export type TournamentSummary = {
  total_tournaments: number;
  avg_buy_in: number;
  avg_prize_pool: number;
  avg_win_amount: number;
  avg_player_count: number;
  total_prize_pool: number;
  biggest_pool: { amount: number; date: string; name: string } | null;
  biggest_win: { amount: number; player_name: string; date: string; tournament_name: string } | null;
  biggest_field: { count: number; date: string; name: string } | null;
  // "In the money" rate: fraction of a player's tournaments where their
  // payout was > 0 (i.e. they cashed). A player can be ITM in a tournament
  // they still net-lost on (multiple re-buys but a small payout). Limited to
  // players with >= 5 appearances so single-tournament anomalies don't win.
  best_itm_rate: { player_name: string; itm_pct: number; itm_count: number; played: number } | null;
  // Highest return on investment: a player's net profit as a percentage of
  // their total cost (net_profit / total_cost * 100), across the in-scope
  // tournaments. Same >= 5 appearances floor as best_itm_rate so a single
  // lucky night can't top the board.
  best_roi: { player_name: string; roi_pct: number; net_profit: number; total_cost: number; played: number } | null;
};
