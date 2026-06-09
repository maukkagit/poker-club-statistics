/**
 * Data-access layer (Supabase / Postgres).
 *
 * Replaces the former Google Sheets backend. Every exported function keeps the
 * same name, signature and behaviour the API routes already depend on, so the
 * routes only had to swap their import path. The schema lives in
 * `supabase/migrations/0001_init.sql`.
 *
 * Conventions:
 *  - All reads exclude soft-deleted rows (`deleted_at is null`).
 *  - User-facing deletes are soft (set `deleted_at`); a deleted tournament also
 *    soft-deletes its entries. `replaceEntriesFor` hard-deletes the entry set it
 *    is replacing, since that's an edit-time sync, not a user "delete".
 */
import type {
  Entry, Location, Player, Tournament, PayoutSlot,
  ComputedEntry, PlayerStats, TournamentSummary, TournamentState, TournamentFilter,
} from "./types";
import { supabase } from "./supabase";

// ---------- Row mappers (Postgres row -> domain type) ----------
// PostgREST already returns jsonb as objects, booleans as booleans and
// timestamps as ISO strings, so these are mostly defensive coercions to match
// the existing domain types exactly.
function mapPlayer(r: any): Player {
  return { id: r.id, name: r.name, created_at: r.created_at };
}
function mapLocation(r: any): Location {
  return { id: r.id, name: r.name, created_at: r.created_at };
}
function mapTournament(r: any): Tournament {
  return {
    id: r.id,
    date: String(r.date),
    name: r.name ?? "",
    buy_in_amount: Number(r.buy_in_amount),
    payout_structure: Array.isArray(r.payout_structure)
      ? r.payout_structure
      : (r.payout_structure ? JSON.parse(r.payout_structure) : []),
    notes: r.notes ?? "",
    location_id: r.location_id ?? null,
    state: r.state === "Active" ? "Active" : "Finished",
    special: Boolean(r.special),
    created_at: r.created_at ?? "",
  };
}
function mapEntry(r: any): Entry {
  return {
    id: r.id,
    tournament_id: r.tournament_id,
    player_id: r.player_id,
    buy_ins: Number(r.buy_ins ?? 0),
    finish_position: r.finish_position == null ? null : Number(r.finish_position),
    payout_override: r.payout_override == null ? null : Number(r.payout_override),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------- Players ----------
export async function listPlayers(): Promise<Player[]> {
  const { data, error } = await supabase()
    .from("players").select("*").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPlayer);
}
export async function createPlayer(name: string): Promise<Player> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name required");
  const { data, error } = await supabase()
    .from("players").insert({ name: trimmed }).select().single();
  if (error) throw new Error(error.message);
  return mapPlayer(data);
}
export async function updatePlayerName(id: string, name: string): Promise<Player> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name required");
  const { data, error } = await supabase()
    .from("players").update({ name: trimmed })
    .eq("id", id).is("deleted_at", null).select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`Player not found: ${id}`);
  return mapPlayer(data[0]);
}

// ---------- Locations ----------
// Names are unique case- and diacritic-insensitively so the UI's
// "type to search or create new" affordance can't produce duplicates like
// "Maukka" + "maukka" + "Maukka ".
function locNorm(s: string): string {
  return s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
export async function listLocations(): Promise<Location[]> {
  const { data, error } = await supabase()
    .from("locations").select("*").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapLocation).sort((a, b) => a.name.localeCompare(b.name));
}
export async function createLocation(name: string): Promise<Location> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Location name required");
  const all = await listLocations();
  const norm = locNorm(trimmed);
  const dup = all.find(l => locNorm(l.name) === norm);
  // Idempotent: if a location with the same normalised name exists, return it
  // instead of creating a duplicate (the TournamentEditor's "type-or-create"
  // combobox relies on this).
  if (dup) return dup;
  const { data, error } = await supabase()
    .from("locations").insert({ name: trimmed }).select().single();
  if (error) throw new Error(error.message);
  return mapLocation(data);
}
export async function updateLocationName(id: string, name: string): Promise<Location> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Location name required");
  const all = await listLocations();
  const existing = all.find(l => l.id === id);
  if (!existing) throw new Error(`Location not found: ${id}`);
  const norm = locNorm(trimmed);
  const dup = all.find(l => l.id !== id && locNorm(l.name) === norm);
  if (dup) throw new Error(`Another location is already named "${dup.name}"`);
  const { data, error } = await supabase()
    .from("locations").update({ name: trimmed })
    .eq("id", id).is("deleted_at", null).select().single();
  if (error) throw new Error(error.message);
  return mapLocation(data);
}
export async function deleteLocation(id: string): Promise<void> {
  // Refuse to delete if any live tournament still references this location.
  const { data: refs, error } = await supabase()
    .from("tournaments").select("id").eq("location_id", id).is("deleted_at", null);
  if (error) throw new Error(error.message);
  const n = refs?.length ?? 0;
  if (n > 0) {
    throw new Error(`Cannot delete: ${n} tournament${n === 1 ? "" : "s"} still use this location`);
  }
  const { error: delErr } = await supabase()
    .from("locations").update({ deleted_at: nowIso() }).eq("id", id);
  if (delErr) throw new Error(delErr.message);
}

// ---------- Tournaments ----------
function validatePayout(p: PayoutSlot[]) {
  if (!p.length) throw new Error("payout_structure cannot be empty");
  const sum = p.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(sum - 100) > 0.01) throw new Error(`payout_structure must sum to 100, got ${sum}`);
}
function validateLocation(locationId: string | null | undefined) {
  // Tournaments require a location. Legacy rows may still have a blank
  // location_id (tolerated on read), but creating/updating without one is
  // rejected here as defense-in-depth.
  if (!locationId || !String(locationId).trim()) {
    throw new Error("location_id is required");
  }
}

/**
 * Comparator used everywhere we sort tournaments chronologically. `date` is
 * day-granular, so when two tournaments share the same date we tiebreak by
 * `created_at`. Both compared as strings — ISO formats sort lexicographically
 * the same as chronologically. Rows missing `created_at` sort first within
 * their date group, matching the historic "no timestamp = oldest" intuition.
 */
function compareTournamentsByDate<T extends { date: string; created_at: string }>(
  a: T, b: T, dir: "asc" | "desc" = "asc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * sign;
  const ac = a.created_at || "";
  const bc = b.created_at || "";
  if (ac !== bc) return (ac < bc ? -1 : 1) * sign;
  return 0;
}

export async function listTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase()
    .from("tournaments").select("*").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTournament)
    .sort((a, b) => compareTournamentsByDate(a, b, "desc"));
}
export async function getTournament(id: string): Promise<Tournament | null> {
  const { data, error } = await supabase()
    .from("tournaments").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTournament(data) : null;
}
export async function createTournament(
  input: Omit<Tournament, "id" | "special" | "created_at"> & {
    state?: TournamentState;
    special?: boolean;
    // Optional override for import/backfill scripts that need to preserve the
    // original creation order of legacy data. The HTTP API never forwards this.
    created_at?: string;
  },
): Promise<Tournament> {
  validatePayout(input.payout_structure);
  validateLocation(input.location_id);
  // Default to Finished so pre-existing callers keep prior behaviour; the UI's
  // "Start tournament" path passes state="Active" explicitly.
  const state: TournamentState = input.state === "Active" ? "Active" : "Finished";
  const row: Record<string, any> = {
    date: input.date,
    name: input.name ?? "",
    buy_in_amount: input.buy_in_amount,
    payout_structure: input.payout_structure,
    notes: input.notes ?? "",
    location_id: input.location_id ?? null,
    state,
    special: Boolean(input.special),
  };
  if (input.created_at && input.created_at.trim()) row.created_at = input.created_at;
  const { data, error } = await supabase()
    .from("tournaments").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapTournament(data);
}
export async function updateTournament(t: Tournament): Promise<Tournament> {
  validatePayout(t.payout_structure);
  validateLocation(t.location_id);
  const state: TournamentState = t.state === "Active" ? "Active" : "Finished";
  // `created_at` and `id` are never updated through this path.
  const { data, error } = await supabase()
    .from("tournaments").update({
      date: t.date,
      name: t.name ?? "",
      buy_in_amount: t.buy_in_amount,
      payout_structure: t.payout_structure,
      notes: t.notes ?? "",
      location_id: t.location_id ?? null,
      state,
      special: Boolean(t.special),
    })
    .eq("id", t.id).is("deleted_at", null).select().single();
  if (error) throw new Error(error.message);
  return mapTournament(data);
}
export async function deleteTournament(id: string): Promise<void> {
  // Soft-delete the tournament and its entries together. (The FK cascade only
  // fires on hard deletes, so we mirror it explicitly here.)
  const ts = nowIso();
  const { error: eErr } = await supabase()
    .from("entries").update({ deleted_at: ts }).eq("tournament_id", id).is("deleted_at", null);
  if (eErr) throw new Error(eErr.message);
  const { error: tErr } = await supabase()
    .from("tournaments").update({ deleted_at: ts }).eq("id", id);
  if (tErr) throw new Error(tErr.message);
}

/**
 * Drop tournaments that should not contribute to dashboard aggregations:
 *  - Active tournaments are always excluded.
 *  - Special tournaments are excluded unless `filter.includeSpecial` is true.
 */
function filterStatsTournaments<T extends Pick<Tournament, "state" | "special">>(
  tournaments: T[], filter?: TournamentFilter,
): T[] {
  const includeSpecial = filter?.includeSpecial ?? false;
  return tournaments.filter(t => t.state === "Finished" && (includeSpecial || !t.special));
}

/**
 * Assign each finished tournament a 1-indexed order number by date ascending
 * (oldest = #1), tiebroken by `created_at` then input-array index. Special
 * tournaments are included; Active ones are excluded.
 */
export function computeTournamentOrderNumbers(tournaments: Tournament[]): Map<string, number> {
  const withIndex = tournaments
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.state === "Finished");
  withIndex.sort((a, b) => {
    const c = compareTournamentsByDate(a.t, b.t, "asc");
    if (c !== 0) return c;
    return a.i - b.i;
  });
  const out = new Map<string, number>();
  withIndex.forEach((x, i) => out.set(x.t.id, i + 1));
  return out;
}

/**
 * Resolve the display name for a tournament: explicit name if present, else
 * "Tournament #N" (finished, with an order number) or "Active tournament".
 */
export function displayTournamentName(t: { name?: string | null; order_number?: number | null; state?: TournamentState }): string {
  const n = (t.name ?? "").trim();
  if (n) return n;
  if (t.state === "Active") return "Active tournament";
  return t.order_number ? `Tournament #${t.order_number}` : "Tournament";
}

// ---------- Entries ----------
export async function listEntries(): Promise<Entry[]> {
  const { data, error } = await supabase()
    .from("entries").select("*").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapEntry);
}
export async function listEntriesFor(tournamentId: string): Promise<Entry[]> {
  const { data, error } = await supabase()
    .from("entries").select("*").eq("tournament_id", tournamentId).is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapEntry);
}
export async function createEntry(input: Omit<Entry, "id">): Promise<Entry> {
  const { data, error } = await supabase()
    .from("entries").insert({
      tournament_id: input.tournament_id,
      player_id: input.player_id,
      buy_ins: input.buy_ins,
      finish_position: input.finish_position,
      payout_override: input.payout_override,
    }).select().single();
  if (error) throw new Error(error.message);
  return mapEntry(data);
}
export async function updateEntry(e: Entry): Promise<Entry> {
  const { data, error } = await supabase()
    .from("entries").update({
      tournament_id: e.tournament_id,
      player_id: e.player_id,
      buy_ins: e.buy_ins,
      finish_position: e.finish_position,
      payout_override: e.payout_override,
    }).eq("id", e.id).select().single();
  if (error) throw new Error(error.message);
  return mapEntry(data);
}
export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase().from("entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Bulk save of entries (replace set for a tournament) ----------
export async function replaceEntriesFor(
  tournamentId: string,
  entries: Omit<Entry, "id" | "tournament_id">[],
): Promise<void> {
  // Hard-delete the existing set then insert the new one — this is an edit-time
  // sync, not a user "delete", so soft-deletes would only accumulate.
  const { error: delErr } = await supabase()
    .from("entries").delete().eq("tournament_id", tournamentId);
  if (delErr) throw new Error(delErr.message);
  if (entries.length === 0) return;
  const rows = entries.map(e => ({
    tournament_id: tournamentId,
    player_id: e.player_id,
    buy_ins: e.buy_ins,
    finish_position: e.finish_position,
    payout_override: e.payout_override,
  }));
  const { error: insErr } = await supabase().from("entries").insert(rows);
  if (insErr) throw new Error(insErr.message);
}

// ---------- Stats / computation (pure) ----------
export function computeEntries(t: Tournament, entries: Entry[]): ComputedEntry[] {
  const totalPool = entries.reduce((s, e) => s + e.buy_ins * t.buy_in_amount, 0);
  const byPos = new Map<number, number>();
  for (const slot of t.payout_structure) {
    byPos.set(slot.position, (slot.pct / 100) * totalPool);
  }
  return entries.map(e => {
    const computed = e.finish_position != null ? (byPos.get(e.finish_position) ?? 0) : 0;
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
    best_itm_rate: null,
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

  const appearances = new Map<string, number>();
  const itmCount = new Map<string, number>();

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
    best_itm_rate: bestItmRate,
  };
}
