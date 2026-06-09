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
  // Highest buy-in count a single player racked up in one tournament
  // (re-entries / rebuys), with who and when.
  most_buy_ins: { count: number; player_name: string; date: string } | null;
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
