// Pure statistics / aggregation. computeEntries and computeTournamentSummary
// take preloaded data; computePlayerStats and computeCumulativeSeries currently
// load their own inputs via the list functions (see #45 for preloaded overloads).
import type {
  Entry, Player, Tournament, ComputedEntry, PlayerStats, TournamentSummary, TournamentFilter,
} from "@/lib/types";
import { listPlayers } from "./players";
import { listTournaments, compareTournamentsByDate } from "./tournaments";
import { listEntries } from "./entries";

/**
 * Drop tournaments that should not contribute to dashboard aggregations:
 *  - Active tournaments are always excluded.
 *  - Special tournaments are excluded unless `filter.includeSpecial` is true.
 */
export function filterStatsTournaments<T extends Pick<Tournament, "state" | "special">>(
  tournaments: T[], filter?: TournamentFilter,
): T[] {
  const includeSpecial = filter?.includeSpecial ?? false;
  return tournaments.filter(t => t.state === "Finished" && (includeSpecial || !t.special));
}

export function computeEntries(t: Tournament, entries: Entry[]): ComputedEntry[] {
  const totalPool = entries.reduce((s, e) => s + e.buy_ins * t.buy_in_amount, 0);
  const byPos = new Map<number, number>();
  for (const slot of t.payout_structure) {
    byPos.set(slot.position, (slot.pct / 100) * totalPool);
  }
  // A "deal" (payout_overrides) overrides the percentage split by finishing
  // position; a per-entry payout_override still wins over everything.
  const dealByPos = t.payout_overrides ?? null;
  return entries.map(e => {
    let computed = 0;
    if (e.finish_position != null) {
      const deal = dealByPos ? dealByPos[String(e.finish_position)] : undefined;
      computed = deal != null ? deal : (byPos.get(e.finish_position) ?? 0);
    }
    const payout = e.payout_override != null ? e.payout_override : computed;
    const cost = e.buy_ins * t.buy_in_amount;
    return { ...e, payout, cost, net: payout - cost };
  });
}

export async function computePlayerStats(filter?: TournamentFilter): Promise<PlayerStats[]> {
  const [players, allTournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const byT = new Map(tournaments.map(t => [t.id, t]));
  const acc = new Map<string, PlayerStats>();
  for (const p of players) acc.set(p.id, {
    player_id: p.id, name: p.name, tournaments: 0, total_buy_ins: 0,
    total_cost: 0, total_winnings: 0, net_profit: 0, avg_net: 0,
    itm_count: 0,
  });
  const tournamentEntriesByT = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!tournamentEntriesByT.has(e.tournament_id)) tournamentEntriesByT.set(e.tournament_id, []);
    tournamentEntriesByT.get(e.tournament_id)!.push(e);
  }
  for (const [tid, es] of tournamentEntriesByT) {
    const t = byT.get(tid);
    if (!t) continue;
    const comp = computeEntries(t, es);
    for (const c of comp) {
      const s = acc.get(c.player_id);
      if (!s) continue;
      s.tournaments += 1;
      s.total_buy_ins += c.buy_ins;
      s.total_cost += c.cost;
      s.total_winnings += c.payout;
      s.net_profit += c.net;
      if (c.payout > 0) s.itm_count += 1;
    }
  }
  for (const s of acc.values()) s.avg_net = s.tournaments ? s.net_profit / s.tournaments : 0;
  return Array.from(acc.values()).sort((a, b) => b.net_profit - a.net_profit);
}

export type CumulativePoint = { date: string; tournamentId: string } & Record<string, number | string | null>;

export async function computeCumulativeSeries(filter?: TournamentFilter): Promise<{
  players: Player[];
  points: CumulativePoint[];
  latestTournamentPlayerIds: string[];
}> {
  const [players, allTournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const tEntries = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!tEntries.has(e.tournament_id)) tEntries.set(e.tournament_id, []);
    tEntries.get(e.tournament_id)!.push(e);
  }
  const ordered = [...tournaments].sort((a, b) => compareTournamentsByDate(a, b, "asc"));
  const running = new Map<string, number>(players.map(p => [p.id, 0]));
  const hasStarted = new Set<string>();
  const points: CumulativePoint[] = [];
  for (const t of ordered) {
    const es = tEntries.get(t.id) ?? [];
    const comp = computeEntries(t, es);
    for (const c of comp) {
      hasStarted.add(c.player_id);
      running.set(c.player_id, (running.get(c.player_id) ?? 0) + c.net);
    }
    const pt: CumulativePoint = { date: t.date, tournamentId: t.id };
    for (const p of players) {
      pt[p.id] = hasStarted.has(p.id)
        ? Number((running.get(p.id) ?? 0).toFixed(2))
        : null;
    }
    points.push(pt);
  }
  const latestTournament = ordered[ordered.length - 1];
  const latestTournamentPlayerIds = latestTournament
    ? Array.from(new Set((tEntries.get(latestTournament.id) ?? []).map(e => e.player_id)))
    : [];
  return { players, points, latestTournamentPlayerIds };
}

/**
 * Aggregate top-level statistics for the Tournaments tab summary card.
 * Pure — takes already-filtered slices (it also drops Active/Special as a
 * safety net). Tiebreaker for "most X" slots: highest count, then name.
 */
export function computeTournamentSummary(
  allTournaments: Tournament[],
  entries: Entry[],
  players: Player[],
  filter?: TournamentFilter,
): TournamentSummary {
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const empty: TournamentSummary = {
    total_tournaments: 0,
    avg_buy_in: 0,
    avg_prize_pool: 0,
    avg_win_amount: 0,
    avg_player_count: 0,
    total_prize_pool: 0,
    biggest_pool: null,
    biggest_win: null,
    biggest_field: null,
    most_buy_ins: null,
    best_itm_rate: null,
    best_roi: null,
  };
  if (tournaments.length === 0) return empty;

  const playerNameById = new Map(players.map(p => [p.id, p.name]));
  const tournamentIds = new Set(tournaments.map(t => t.id));

  const entriesByT = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!tournamentIds.has(e.tournament_id)) continue;
    if (!entriesByT.has(e.tournament_id)) entriesByT.set(e.tournament_id, []);
    entriesByT.get(e.tournament_id)!.push(e);
  }

  let totalPool = 0;
  let totalBuyIn = 0;
  let totalWinAmount = 0;
  let totalPlayerCount = 0;
  let winAmountSamples = 0;
  let biggestPool: TournamentSummary["biggest_pool"] = null;
  let biggestField: TournamentSummary["biggest_field"] = null;
  let biggestWin: TournamentSummary["biggest_win"] = null;
  let mostBuyIns: TournamentSummary["most_buy_ins"] = null;

  const appearances = new Map<string, number>();
  const itmCount = new Map<string, number>();
  // Per-player net profit and cost across the in-scope tournaments, used for
  // the "highest ROI" leaderboard slot.
  const netByPlayer = new Map<string, number>();
  const costByPlayer = new Map<string, number>();

  for (const t of tournaments) {
    const es = entriesByT.get(t.id) ?? [];

    const pool = es.reduce((s, e) => s + e.buy_ins * t.buy_in_amount, 0);
    const distinctPlayers = new Set(es.map(e => e.player_id));
    const playerCount = distinctPlayers.size;
    const firstPct = t.payout_structure[0]?.pct ?? 0;
    const winAmount = pool * (firstPct / 100);

    totalPool += pool;
    totalBuyIn += t.buy_in_amount;
    totalPlayerCount += playerCount;
    if (pool > 0) {
      totalWinAmount += winAmount;
      winAmountSamples += 1;
    }

    if (!biggestPool || pool > biggestPool.amount) {
      biggestPool = { amount: pool, date: t.date, name: t.name };
    }
    if (!biggestField || playerCount > biggestField.count) {
      biggestField = { count: playerCount, date: t.date, name: t.name };
    }

    const comp = computeEntries(t, es);
    for (const c of comp) {
      appearances.set(c.player_id, (appearances.get(c.player_id) ?? 0) + 1);
      netByPlayer.set(c.player_id, (netByPlayer.get(c.player_id) ?? 0) + c.net);
      costByPlayer.set(c.player_id, (costByPlayer.get(c.player_id) ?? 0) + c.cost);
      if (!mostBuyIns || c.buy_ins > mostBuyIns.count) {
        mostBuyIns = {
          count: c.buy_ins,
          player_name: playerNameById.get(c.player_id) ?? "(unknown)",
          date: t.date,
        };
      }
      if (c.payout > 0) {
        itmCount.set(c.player_id, (itmCount.get(c.player_id) ?? 0) + 1);
        if (!biggestWin || c.payout > biggestWin.amount) {
          biggestWin = {
            amount: c.payout,
            player_name: playerNameById.get(c.player_id) ?? "(unknown)",
            date: t.date,
            tournament_name: t.name,
          };
        }
      }
    }
  }

  const MIN_APPEARANCES_FOR_ITM = 5;
  let bestItmRate: TournamentSummary["best_itm_rate"] = null;
  for (const [pid, played] of appearances) {
    if (played < MIN_APPEARANCES_FOR_ITM) continue;
    const c = itmCount.get(pid) ?? 0;
    const pct = (c / played) * 100;
    const name = playerNameById.get(pid) ?? "(unknown)";
    if (
      !bestItmRate ||
      pct > bestItmRate.itm_pct ||
      (pct === bestItmRate.itm_pct && c > bestItmRate.itm_count) ||
      (pct === bestItmRate.itm_pct && c === bestItmRate.itm_count && name.localeCompare(bestItmRate.player_name) < 0)
    ) {
      bestItmRate = { player_name: name, itm_pct: pct, itm_count: c, played };
    }
  }

  // Highest ROI among players with >= MIN_APPEARANCES_FOR_ITM appearances and a
  // positive total cost. Tie-break by higher net profit, then alphabetical name.
  let bestRoi: TournamentSummary["best_roi"] = null;
  for (const [pid, played] of appearances) {
    if (played < MIN_APPEARANCES_FOR_ITM) continue;
    const cost = costByPlayer.get(pid) ?? 0;
    if (cost <= 0) continue;
    const net = netByPlayer.get(pid) ?? 0;
    const pct = (net / cost) * 100;
    const name = playerNameById.get(pid) ?? "(unknown)";
    if (
      !bestRoi ||
      pct > bestRoi.roi_pct ||
      (pct === bestRoi.roi_pct && net > bestRoi.net_profit) ||
      (pct === bestRoi.roi_pct && net === bestRoi.net_profit && name.localeCompare(bestRoi.player_name) < 0)
    ) {
      bestRoi = { player_name: name, roi_pct: pct, net_profit: net, total_cost: cost, played };
    }
  }

  const n = tournaments.length;
  return {
    total_tournaments: n,
    avg_buy_in: totalBuyIn / n,
    avg_prize_pool: totalPool / n,
    avg_win_amount: winAmountSamples ? totalWinAmount / winAmountSamples : 0,
    avg_player_count: totalPlayerCount / n,
    total_prize_pool: totalPool,
    biggest_pool: biggestPool,
    biggest_win: biggestWin,
    biggest_field: biggestField,
    most_buy_ins: mostBuyIns,
    best_itm_rate: bestItmRate,
    best_roi: bestRoi,
  };
}
