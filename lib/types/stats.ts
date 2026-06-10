// Aggregation / statistics shapes and the filter that scopes them. These are
// derived (not persisted) and consumed by the dashboard, player detail and
// summary computations. Import from "@/lib/types".

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
