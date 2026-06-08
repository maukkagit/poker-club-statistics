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
};
