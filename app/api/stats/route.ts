import { NextResponse } from "next/server";
import {
  computePlayerStats,
  computeCumulativeSeries,
  computeTournamentSummary,
  computeTournamentOrderNumbers,
  displayTournamentName,
  listTournaments,
  listEntries,
  listPlayers,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fetch raw data once and feed it into both the stats/series computations
  // and the dashboard summary tile aggregation. Doing this inside the route
  // (instead of inside each compute* helper) keeps it to a single round-trip
  // per logical block at the Sheets API edge.
  const [tournaments, entries, players, stats, series] = await Promise.all([
    listTournaments(),
    listEntries(),
    listPlayers(),
    computePlayerStats(),
    computeCumulativeSeries(),
  ]);
  // Pre-resolve each tournament's display name (with the "Tournament #N"
  // fallback) before feeding into the summary computation so the biggest
  // pool / biggest field tiles show a meaningful label when the user
  // didn't bother naming the night.
  const orderById = computeTournamentOrderNumbers(tournaments);
  const tournamentsForSummary = tournaments.map(t => ({
    ...t,
    name: displayTournamentName({ name: t.name, order_number: orderById.get(t.id) ?? null, state: t.state }),
  }));
  const summary = computeTournamentSummary(tournamentsForSummary, entries, players);
  return NextResponse.json({ stats, series, summary });
}
