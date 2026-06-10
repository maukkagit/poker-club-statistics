import { NextResponse } from "next/server";
import {
  listPlayers,
  listTournaments,
  listEntries,
  listLocations,
  computeEntries,
  computeTournamentOrderNumbers,
  displayTournamentName,
} from "@/lib/db";
import type { Player } from "@/lib/types";
import { parseIncludeSpecial } from "@/lib/http/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Head-to-head ("Face Off") endpoint.
 *
 * Compares two players against each other across the set of tournaments
 * BOTH have played in (and which are Finished — Active games are skipped
 * the same way the dashboard skips them).
 *
 * Query params:
 *   - `a`               player_id for the left side (required for a real result)
 *   - `b`               player_id for the right side (required for a real result)
 *   - `includeSpecial`  "1"/"true" to opt special tournaments back in
 *                       (mirrors /api/stats and /api/players/[id])
 *
 * Either player id may be omitted (e.g. when the user has only picked one
 * side so far). In that case `shared_count` is 0 and `history`/`stats*`
 * are empty / zeroed — the page can still render the picked card.
 *
 * If `a === b`, the request is treated the same as "only one player
 * selected" (no point in comparing a player to themselves).
 */

type SideStats = {
  // 1st-place finishes (used as the headline "Wins" metric).
  wins: number;
  // Tournaments where this player cashed (payout > 0).
  itm_count: number;
  // Lowest (best) finish position recorded; null if no positions recorded.
  best_finish: number | null;
  // Mean finish position across shared tournaments where a finish was
  // recorded. null when the player has no recorded finishes.
  avg_finish: number | null;
  total_buy_ins: number;
  total_cost: number;
  total_winnings: number;
  net_profit: number;
  // Head-to-head: number of shared tournaments where this player's
  // finish_position was strictly better (numerically lower) than the
  // opponent's. Tournaments where either side has no recorded finish
  // are excluded so the count is symmetric (h2h_wins_a + h2h_wins_b +
  // ties === count of comparable rows).
  h2h_wins: number;
};

type SidePerTournament = {
  finish_position: number | null;
  buy_ins: number;
  payout: number;
  cost: number;
  net: number;
};

type HistoryRow = {
  tournament_id: string;
  date: string;
  display_name: string;
  location_name: string | null;
  special: boolean;
  a: SidePerTournament;
  b: SidePerTournament;
};

function emptyStats(): SideStats {
  return {
    wins: 0,
    itm_count: 0,
    best_finish: null,
    avg_finish: null,
    total_buy_ins: 0,
    total_cost: 0,
    total_winnings: 0,
    net_profit: 0,
    h2h_wins: 0,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const aId = url.searchParams.get("a") ?? "";
  const bId = url.searchParams.get("b") ?? "";
  const includeSpecial = parseIncludeSpecial(req);

  const [players, allTournaments, entries, locations] = await Promise.all([
    listPlayers(),
    listTournaments(),
    listEntries(),
    listLocations(),
  ]);

  const playerA: Player | null = aId ? (players.find(p => p.id === aId) ?? null) : null;
  const playerB: Player | null = bId ? (players.find(p => p.id === bId) ?? null) : null;

  // Early exit: not enough info to compare. Still return both player
  // records (whichever was found) so the page can render the picked-card
  // skeleton.
  if (!playerA || !playerB || playerA.id === playerB.id) {
    return NextResponse.json({
      playerA,
      playerB,
      shared_count: 0,
      statsA: emptyStats(),
      statsB: emptyStats(),
      history: [] as HistoryRow[],
    });
  }

  const locationNameById = new Map(locations.map(l => [l.id, l.name]));
  const orderById = computeTournamentOrderNumbers(allTournaments);

  // Group entries by tournament once so the inner loop stays O(1) per
  // tournament rather than O(entries) per lookup.
  const entriesByT = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!entriesByT.has(e.tournament_id)) entriesByT.set(e.tournament_id, []);
    entriesByT.get(e.tournament_id)!.push(e);
  }

  const statsA = emptyStats();
  const statsB = emptyStats();
  const history: HistoryRow[] = [];
  // Running sums + counts for averaging finish positions only across the
  // shared tournaments where each player actually has a recorded finish.
  let finishSumA = 0, finishCountA = 0;
  let finishSumB = 0, finishCountB = 0;

  for (const t of allTournaments) {
    // Same filters every other stats path uses: Active games never count,
    // Special games only when explicitly opted in.
    if (t.state !== "Finished") continue;
    if (!includeSpecial && t.special) continue;
    const ts = entriesByT.get(t.id);
    if (!ts) continue;
    const aEntry = ts.find(e => e.player_id === playerA.id);
    const bEntry = ts.find(e => e.player_id === playerB.id);
    // Both players must have played for this tournament to count toward
    // the rivalry.
    if (!aEntry || !bEntry) continue;

    // Compute payouts from the FULL entry set so the per-position euros
    // match the tournament's actual pool — restricting to just A+B would
    // shrink the pool and give wrong winnings figures.
    const computed = computeEntries(t, ts);
    const a = computed.find(c => c.player_id === playerA.id)!;
    const b = computed.find(c => c.player_id === playerB.id)!;

    // Accumulate the stat rows.
    if (a.finish_position === 1) statsA.wins += 1;
    if (b.finish_position === 1) statsB.wins += 1;
    if (a.payout > 0) statsA.itm_count += 1;
    if (b.payout > 0) statsB.itm_count += 1;
    if (a.finish_position != null) {
      finishSumA += a.finish_position; finishCountA += 1;
      if (statsA.best_finish == null || a.finish_position < statsA.best_finish) {
        statsA.best_finish = a.finish_position;
      }
    }
    if (b.finish_position != null) {
      finishSumB += b.finish_position; finishCountB += 1;
      if (statsB.best_finish == null || b.finish_position < statsB.best_finish) {
        statsB.best_finish = b.finish_position;
      }
    }
    statsA.total_buy_ins += a.buy_ins;
    statsB.total_buy_ins += b.buy_ins;
    statsA.total_cost += a.cost;
    statsB.total_cost += b.cost;
    statsA.total_winnings += a.payout;
    statsB.total_winnings += b.payout;
    statsA.net_profit += a.net;
    statsB.net_profit += b.net;
    // Head-to-head only meaningful when both players have a recorded
    // finish. Ties (same position — shouldn't happen but defensive)
    // count for neither side.
    if (a.finish_position != null && b.finish_position != null) {
      if (a.finish_position < b.finish_position) statsA.h2h_wins += 1;
      else if (b.finish_position < a.finish_position) statsB.h2h_wins += 1;
    }

    history.push({
      tournament_id: t.id,
      date: t.date,
      display_name: displayTournamentName({
        name: t.name,
        order_number: orderById.get(t.id) ?? null,
        state: t.state,
      }),
      location_name: t.location_id ? (locationNameById.get(t.location_id) ?? null) : null,
      special: t.special,
      a: {
        finish_position: a.finish_position,
        buy_ins: a.buy_ins,
        payout: a.payout,
        cost: a.cost,
        net: a.net,
      },
      b: {
        finish_position: b.finish_position,
        buy_ins: b.buy_ins,
        payout: b.payout,
        cost: b.cost,
        net: b.net,
      },
    });
  }

  statsA.avg_finish = finishCountA > 0 ? finishSumA / finishCountA : null;
  statsB.avg_finish = finishCountB > 0 ? finishSumB / finishCountB : null;

  // Newest first — same convention as the tournaments list and the
  // per-player history table.
  history.sort((a, b) => (a.date < b.date ? 1 : -1));

  return NextResponse.json({
    playerA,
    playerB,
    shared_count: history.length,
    statsA,
    statsB,
    history,
  });
}
