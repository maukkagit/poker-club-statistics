// Pure statistics / aggregation. The `*From` functions take preloaded data
// (players/tournaments/entries) so a route can fetch once and feed several
// computations; the async `computePlayerStats`/`computeCumulativeSeries`
// wrappers fetch via the list functions and delegate to the pure cores.
import type {
  Entry, Player, Tournament, ComputedEntry, PlayerStats, TournamentSummary, TournamentFilter, Knockout,
} from "@/lib/types";
import { listPlayers } from "./players";
import { listTournaments, compareTournamentsByDate } from "./tournaments";
import { listEntries } from "./entries";
import { listKnockouts } from "./knockouts";
import { computeBountyState, bountyConfig } from "@/lib/pko";

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

export function computeEntries(t: Tournament, entries: Entry[], knockouts?: Knockout[]): ComputedEntry[] {
  // Add-ons fund the regular pool only (never a fresh PKO bounty), same
  // treatment as `buy_in_amount` on a rebuy.
  const addonPrice = t.addon_price ?? 0;
  const totalPool = entries.reduce(
    (s, e) => s + e.buy_ins * t.buy_in_amount + (e.addons ?? 0) * addonPrice, 0,
  );
  const byPos = new Map<number, number>();
  for (const slot of t.payout_structure) {
    byPos.set(slot.position, (slot.pct / 100) * totalPool);
  }
  // A "deal" (payout_overrides) overrides the percentage split by finishing
  // position; a per-entry payout_override still wins over everything.
  const dealByPos = t.payout_overrides ?? null;

  // PKO: each buy-in/re-entry also costs the starting bounty, and cash bounties
  // are derived from the knockout ledger (when provided). The 1st-place finisher
  // cashes their own remaining bounty.
  const bountyByPlayer = new Map<string, number>();
  const bountyStart = t.is_pko ? (t.bounty_start_amount ?? 0) : 0;
  if (t.is_pko && knockouts) {
    const champion = entries.find(e => e.finish_position === 1)?.player_id ?? null;
    const state = computeBountyState(
      entries.map(e => e.player_id), knockouts, bountyConfig(t), champion,
    );
    for (const [pid, s] of state.byPlayer) bountyByPlayer.set(pid, s.cashWon);
  }

  return entries.map(e => {
    let computed = 0;
    if (e.finish_position != null) {
      const deal = dealByPos ? dealByPos[String(e.finish_position)] : undefined;
      computed = deal != null ? deal : (byPos.get(e.finish_position) ?? 0);
    }
    const payout = e.payout_override != null ? e.payout_override : computed;
    const bounty_won = t.is_pko ? (bountyByPlayer.get(e.player_id) ?? 0) : 0;
    // For PKO each buy-in/re-entry also costs the starting bounty; add-ons
    // bought are an extra, flat cost on top (not scaled by buy_ins).
    const cost = e.buy_ins * t.buy_in_amount + (t.is_pko ? e.buy_ins * bountyStart : 0)
      + (e.addons ?? 0) * addonPrice;
    return { ...e, payout, cost, bounty_won, net: payout + bounty_won - cost };
  });
}

export async function computePlayerStats(filter?: TournamentFilter): Promise<PlayerStats[]> {
  const [players, allTournaments, entries, knockouts] = await Promise.all([
    listPlayers(), listTournaments(), listEntries(), listKnockouts(),
  ]);
  return computePlayerStatsFrom(players, allTournaments, entries, filter, knockouts);
}

/** Group a flat knockout list by tournament id. */
function groupKnockoutsByT(knockouts: Knockout[]): Map<string, Knockout[]> {
  const m = new Map<string, Knockout[]>();
  for (const k of knockouts) {
    if (!m.has(k.tournament_id)) m.set(k.tournament_id, []);
    m.get(k.tournament_id)!.push(k);
  }
  return m;
}

/** Pure core of {@link computePlayerStats}: identical maths over preloaded data. */
export function computePlayerStatsFrom(
  players: Player[], allTournaments: Tournament[], entries: Entry[], filter?: TournamentFilter,
  knockouts: Knockout[] = [],
): PlayerStats[] {
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const byT = new Map(tournaments.map(t => [t.id, t]));
  const koByT = groupKnockoutsByT(knockouts);
  const acc = new Map<string, PlayerStats>();
  for (const p of players) acc.set(p.id, {
    player_id: p.id, name: p.name, tournaments: 0, total_buy_ins: 0,
    total_cost: 0, total_winnings: 0, total_bounty_won: 0, net_profit: 0, avg_net: 0,
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
    const comp = computeEntries(t, es, koByT.get(tid));
    for (const c of comp) {
      const s = acc.get(c.player_id);
      if (!s) continue;
      s.tournaments += 1;
      s.total_buy_ins += c.buy_ins;
      s.total_cost += c.cost;
      s.total_winnings += c.payout + c.bounty_won;
      s.total_bounty_won += c.bounty_won;
      s.net_profit += c.net;
      if (c.payout > 0 || c.bounty_won > 0) s.itm_count += 1;
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
  const [players, allTournaments, entries, knockouts] = await Promise.all([
    listPlayers(), listTournaments(), listEntries(), listKnockouts(),
  ]);
  return computeCumulativeSeriesFrom(players, allTournaments, entries, filter, knockouts);
}

/** Pure core of {@link computeCumulativeSeries}: identical maths over preloaded data. */
export function computeCumulativeSeriesFrom(
  players: Player[], allTournaments: Tournament[], entries: Entry[], filter?: TournamentFilter,
  knockouts: Knockout[] = [],
): {
  players: Player[];
  points: CumulativePoint[];
  latestTournamentPlayerIds: string[];
} {
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const koByT = groupKnockoutsByT(knockouts);
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
    const comp = computeEntries(t, es, koByT.get(t.id));
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
 *
 * `asOfDate` (yyyy-mm-dd) is the reference day for the trailing-year average;
 * defaults to today. Tests pass a fixed date so the metric stays deterministic.
 */
export function computeTournamentSummary(
  allTournaments: Tournament[],
  entries: Entry[],
  players: Player[],
  filter?: TournamentFilter,
  knockouts: Knockout[] = [],
  asOfDate?: string,
): TournamentSummary {
  const tournaments = filterStatsTournaments(allTournaments, filter);
  const koByT = groupKnockoutsByT(knockouts);
  const empty: TournamentSummary = {
    total_tournaments: 0,
    avg_tournaments_per_month: 0,
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
    const comp = computeEntries(t, es, koByT.get(t.id));

    // Prize pool = the regular buy-in pool (incl. add-on money) plus, for PKO
    // tournaments, the bounty pool (every buy-in/re-entry also funds the
    // starting bounty). All prize-pool metrics report this combined total so
    // PKO bounty money is included alongside the standard pool.
    const addonPrice = t.addon_price ?? 0;
    const buyInPool = es.reduce((s, e) => s + e.buy_ins * t.buy_in_amount + (e.addons ?? 0) * addonPrice, 0);
    const bountyStart = t.is_pko ? (t.bounty_start_amount ?? 0) : 0;
    const bountyPool = es.reduce((s, e) => s + e.buy_ins * bountyStart, 0);
    const pool = buyInPool + bountyPool;
    const distinctPlayers = new Set(es.map(e => e.player_id));
    const playerCount = distinctPlayers.size;
    const firstPct = t.payout_structure[0]?.pct ?? 0;
    // 1st-place take = the winner's share of the buy-in pool plus (for PKO)
    // the champion's total bounty winnings, so the figure reflects everything
    // the winner actually took home including bounty money.
    const championBounty = comp.find(c => c.finish_position === 1)?.bounty_won ?? 0;
    const winAmount = buyInPool * (firstPct / 100) + championBounty;

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
      }
      // Biggest single win counts total winnings (regular payout + bounty won),
      // so a PKO player who cashed only bounties can still register.
      const winnings = c.payout + c.bounty_won;
      if (winnings > 0 && (!biggestWin || winnings > biggestWin.amount)) {
        biggestWin = {
          amount: winnings,
          player_name: playerNameById.get(c.player_id) ?? "(unknown)",
          date: t.date,
          tournament_name: t.name,
        };
      }
    }
  }

  const MIN_APPEARANCES_FOR_ITM = 10;
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
  // Trailing-year pace: count finished tournaments dated on/after (asOf − 365
  // days), then divide by a fixed 12 so the figure is "per month" over a full
  // year — empty months still count in the denominator.
  const cutoff = ymdDaysAgo(365, asOfDate);
  const recentCount = tournaments.reduce((c, t) => c + (t.date >= cutoff ? 1 : 0), 0);
  return {
    total_tournaments: n,
    avg_tournaments_per_month: recentCount / 12,
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

/** Calendar date `days` before `asOf` (yyyy-mm-dd), or before today when omitted. */
function ymdDaysAgo(days: number, asOf?: string): string {
  const base = asOf ? new Date(`${asOf}T12:00:00`) : new Date();
  base.setDate(base.getDate() - days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
