export type Player = { id: string; name: string; created_at: string };

export type PayoutSlot = { position: number; pct: number };

export type Tournament = {
  id: string;
  date: string;            // ISO date (yyyy-mm-dd)
  name: string;
  buy_in_amount: number;   // EUR per buy-in
  payout_structure: PayoutSlot[]; // e.g. [{position:1,pct:60}, ...] must sum to 100
  notes?: string;
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
};
