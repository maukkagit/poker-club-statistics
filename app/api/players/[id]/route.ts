import { NextResponse } from "next/server";
import {
  listPlayers,
  listTournaments,
  listEntries,
  listLocations,
  computeEntries,
  computePlayerStats,
  computeTournamentOrderNumbers,
  displayTournamentName,
} from "@/lib/db";
import type { TournamentFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Per-player detail endpoint feeding the /players/[id] view.
 *
 * Returns:
 *   - `player`     — the bare Player row (name, created_at)
 *   - `stats`      — the same PlayerStats row the dashboard uses for this
 *                    player, re-computed under the active filter so the
 *                    summary tiles agree with the included-tournaments
 *                    list below.
 *   - `tournaments`— one row per (tournament played by this player), with
 *                    the per-tournament numerics already computed
 *                    (buy_ins, finish_position, payout, cost, net) plus
 *                    enough denormalised metadata (date, display_name,
 *                    location_name, special flag) to render the history
 *                    table without a second round-trip.
 *
 * The `includeSpecial` query param mirrors /api/stats so the dashboard's
 * toggle can be applied to this page too.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const includeSpecialParam = url.searchParams.get("includeSpecial");
  const includeSpecial = includeSpecialParam === "1" || includeSpecialParam === "true";
  const filter: TournamentFilter = { includeSpecial };

  const [players, allTournaments, entries, locations, allStats] = await Promise.all([
    listPlayers(),
    listTournaments(),
    listEntries(),
    listLocations(),
    computePlayerStats(filter),
  ]);

  const player = players.find(p => p.id === params.id);
  if (!player) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Reuse the dashboard's aggregate so the summary tiles on this page are
  // guaranteed identical to the player's row on the dashboard. If the
  // player has never been in a (currently-included) tournament, the
  // helper still returns a zeroed row keyed by player_id.
  const stats = allStats.find(s => s.player_id === player.id) ?? {
    player_id: player.id,
    name: player.name,
    tournaments: 0,
    total_buy_ins: 0,
    total_cost: 0,
    total_winnings: 0,
    net_profit: 0,
    avg_net: 0,
    itm_count: 0,
  };

  const locationNameById = new Map(locations.map(l => [l.id, l.name]));
  const orderById = computeTournamentOrderNumbers(allTournaments);
  // We only want this player's history, so group all entries by tournament
  // once and then iterate the tournaments the player actually appears in.
  const entriesByT = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!entriesByT.has(e.tournament_id)) entriesByT.set(e.tournament_id, []);
    entriesByT.get(e.tournament_id)!.push(e);
  }

  // Build the history rows. Honours the same Active / Special filter as
  // the stats above so the table and the tiles agree row-for-row.
  type HistoryRow = {
    tournament_id: string;
    date: string;
    name: string;
    display_name: string;
    state: string;
    special: boolean;
    location_name: string | null;
    buy_ins: number;
    finish_position: number | null;
    payout: number;
    cost: number;
    net: number;
  };
  const history: HistoryRow[] = [];
  for (const t of allTournaments) {
    if (t.state !== "Finished") continue;
    if (!includeSpecial && t.special) continue;
    const ts = entriesByT.get(t.id);
    if (!ts) continue;
    const ours = ts.find(e => e.player_id === player.id);
    if (!ours) continue;
    // Compute payout / cost / net using the full entry set so the pool
    // and per-position payouts match what the tournament edit page shows.
    const computed = computeEntries(t, ts);
    const me = computed.find(c => c.player_id === player.id);
    if (!me) continue;
    history.push({
      tournament_id: t.id,
      date: t.date,
      name: t.name,
      display_name: displayTournamentName({
        name: t.name,
        order_number: orderById.get(t.id) ?? null,
        state: t.state,
      }),
      state: t.state,
      special: t.special,
      location_name: t.location_id ? (locationNameById.get(t.location_id) ?? null) : null,
      buy_ins: me.buy_ins,
      finish_position: me.finish_position,
      payout: me.payout,
      cost: me.cost,
      net: me.net,
    });
  }
  // Newest first — same chronological convention as the tournaments list.
  history.sort((a, b) => (a.date < b.date ? 1 : -1));

  return NextResponse.json({ player, stats, tournaments: history });
}
