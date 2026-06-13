// JSON shapes returned by the API routes and consumed by the client/SWR.
// Centralised here so a page and its route agree on one definition instead of
// re-declaring it locally. Import from "@/lib/types".
import type { Player, StructureRow, TournamentClock, TournamentState } from "./entities";
import type { PlayerStats, TournamentSummary } from "./stats";
import type { ClockAggregates } from "@/lib/tournament-clock";

/**
 * One point on the cumulative-profit chart: a tournament's date/id plus each
 * player's running net (keyed by player id; `null` before that player's first
 * appearance). Mirrors `CumulativePoint` produced by `computeCumulativeSeries`.
 */
export type CumulativeSeriesPoint = { date: string; tournamentId: string } & Record<string, number | string | null>;

/** Body of `GET /api/stats`, consumed by the dashboard. */
export type StatsResponse = {
  stats: PlayerStats[];
  series: {
    players: Player[];
    points: CumulativeSeriesPoint[];
    latestTournamentPlayerIds?: string[];
  };
  summary: TournamentSummary;
};

/**
 * Body of `GET /api/public/clock/{token}` — the read-only projector clock.
 * Deliberately minimal: structure + counter (so the client can tick locally),
 * headline aggregates and payout amounts. No player names, ids or seating.
 */
export type PublicClock = {
  title: string;
  state: TournamentState;
  structure: StructureRow[];
  starting_stack: number | null;
  clock: TournamentClock | null;
  aggregates: ClockAggregates;
  payouts: { position: number; amount: number }[];
};
