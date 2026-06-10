// JSON shapes returned by the API routes and consumed by the client/SWR.
// Centralised here so a page and its route agree on one definition instead of
// re-declaring it locally. Import from "@/lib/types".
import type { Player } from "./entities";
import type { PlayerStats, TournamentSummary } from "./stats";

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
