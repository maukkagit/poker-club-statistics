import { NextResponse } from "next/server";
import {
  computePlayerStatsFrom,
  computeCumulativeSeriesFrom,
  computeTournamentSummary,
  computeTournamentOrderNumbers,
  displayTournamentName,
  listTournaments,
  listEntries,
  listPlayers,
  listKnockouts,
} from "@/lib/db";
import type { TournamentFilter } from "@/lib/types";
import { parseIncludeSpecial } from "@/lib/http/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Toggle on the dashboard sends `?includeSpecial=1` to include the
  // "Special tournament" events in every aggregation. Absent / falsy
  // values keep the default behaviour of excluding them.
  const filter: TournamentFilter = { includeSpecial: parseIncludeSpecial(req) };

  // Fetch raw data once and feed it into the stats/series computations AND the
  // dashboard summary tile aggregation via the pure `*From` cores. Previously
  // computePlayerStats/computeCumulativeSeries each re-fetched the same three
  // tables, so a single dashboard load triggered the reads three times over.
  const [tournaments, entries, players, knockouts] = await Promise.all([
    listTournaments(),
    listEntries(),
    listPlayers(),
    listKnockouts(),
  ]);
  const stats = computePlayerStatsFrom(players, tournaments, entries, filter, knockouts);
  const series = computeCumulativeSeriesFrom(players, tournaments, entries, filter, knockouts);
  // Pre-resolve each tournament's display name (with the "Tournament #N"
  // fallback) before feeding into the summary computation so the biggest
  // pool / biggest field tiles show a meaningful label when the user
  // didn't bother naming the night.
  const orderById = computeTournamentOrderNumbers(tournaments);
  const tournamentsForSummary = tournaments.map(t => ({
    ...t,
    name: displayTournamentName({ name: t.name, order_number: orderById.get(t.id) ?? null, state: t.state }),
  }));
  const summary = computeTournamentSummary(tournamentsForSummary, entries, players, filter, knockouts);
  return NextResponse.json({ stats, series, summary });
}
