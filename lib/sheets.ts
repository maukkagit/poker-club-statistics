import { google, sheets_v4 } from "googleapis";
import { v4 as uuid } from "uuid";
import type { Entry, Location, Player, Tournament, PayoutSlot, ComputedEntry, PlayerStats, TournamentSummary, TournamentState } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let _client: sheets_v4.Sheets | null = null;
function client(): sheets_v4.Sheets {
  if (_client) return _client;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT({ email, key, scopes: SCOPES });
  _client = google.sheets({ version: "v4", auth });
  return _client;
}
function sheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

export const TABS = {
  Players: { name: "Players", header: ["id", "name", "created_at"] },
  Locations: { name: "Locations", header: ["id", "name", "created_at"] },
  // `location_id` (col G) and `state` (col H) were added after the original
  // schema existed. The parser tolerates missing trailing cells:
  //   - missing `location_id` → null (legacy import)
  //   - missing / unknown `state` → "Finished" (every legacy row is, by
  //     definition, a finished tournament — the Active state is new).
  Tournaments: { name: "Tournaments", header: ["id", "date", "name", "buy_in_amount", "payout_structure", "notes", "location_id", "state"] },
  Entries: { name: "Entries", header: ["id", "tournament_id", "player_id", "buy_ins", "finish_position", "payout_override"] },
  Meta: { name: "Meta", header: ["key", "value"] },
} as const;

async function getAll(tab: string): Promise<string[][]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A1:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values ?? []) as string[][];
}

function rowsToObjects<T extends Record<string, any>>(rows: string[][], header: readonly string[]): T[] {
  if (rows.length <= 1) return [];
  return rows.slice(1).filter(r => r.length && r[0] !== "").map(r => {
    const o: any = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o as T;
  });
}

async function append(tab: string, row: (string | number | null)[]) {
  await client().spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [row.map(v => (v == null ? "" : v))] },
  });
}

async function findRowIndex(tab: string, id: string): Promise<number> {
  const rows = await getAll(tab);
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === id) return i + 1; // 1-based
  return -1;
}

async function updateRow(tab: string, id: string, row: (string | number | null)[]) {
  const idx = await findRowIndex(tab, id);
  if (idx < 0) throw new Error(`${tab}: id not found: ${id}`);
  await client().spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${tab}!A${idx}:Z${idx}`,
    valueInputOption: "RAW",
    requestBody: { values: [row.map(v => (v == null ? "" : v))] },
  });
}

async function deleteRow(tab: string, id: string) {
  const idx = await findRowIndex(tab, id);
  if (idx < 0) return;
  // get sheet metadata to find sheetId for that tab
  const meta = await client().spreadsheets.get({ spreadsheetId: sheetId() });
  const s = meta.data.sheets?.find(s => s.properties?.title === tab);
  const sid = s?.properties?.sheetId;
  if (sid == null) throw new Error(`tab not found: ${tab}`);
  await client().spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId: sid, dimension: "ROWS", startIndex: idx - 1, endIndex: idx } } }],
    },
  });
}

// ---------- Players ----------
export async function listPlayers(): Promise<Player[]> {
  const rows = await getAll(TABS.Players.name);
  return rowsToObjects<Player>(rows, TABS.Players.header);
}
export async function createPlayer(name: string): Promise<Player> {
  const p: Player = { id: uuid(), name: name.trim(), created_at: new Date().toISOString() };
  if (!p.name) throw new Error("Player name required");
  await append(TABS.Players.name, [p.id, p.name, p.created_at]);
  return p;
}
export async function updatePlayerName(id: string, name: string): Promise<Player> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Player name required");
  const all = await listPlayers();
  const existing = all.find(p => p.id === id);
  if (!existing) throw new Error(`Player not found: ${id}`);
  // Preserve created_at — only the name is editable. The sheet's row order
  // doesn't matter for correctness, but updating in-place avoids shuffling.
  const updated: Player = { ...existing, name: trimmed };
  await updateRow(TABS.Players.name, id, [updated.id, updated.name, updated.created_at]);
  return updated;
}

// ---------- Locations ----------
// Locations are a tiny lookup table — a tournament references one via
// `location_id`. Names are unique (case- and diacritic-insensitive) so the
// UI's "type to search or create new" affordance can't accidentally produce
// duplicates like "Maukka" + "maukka" + "Maukka ".
function locNorm(s: string): string {
  return s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
export async function listLocations(): Promise<Location[]> {
  const rows = await getAll(TABS.Locations.name);
  return rowsToObjects<Location>(rows, TABS.Locations.header)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function createLocation(name: string): Promise<Location> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Location name required");
  const all = await listLocations();
  const norm = locNorm(trimmed);
  const dup = all.find(l => locNorm(l.name) === norm);
  if (dup) {
    // Idempotent: if a location with the same normalised name exists, return
    // it instead of creating a duplicate. The TournamentEditor's
    // "type-or-create" combobox depends on this so a race between two tabs
    // can't produce two rows that look identical to the user.
    return dup;
  }
  const l: Location = { id: uuid(), name: trimmed, created_at: new Date().toISOString() };
  await append(TABS.Locations.name, [l.id, l.name, l.created_at]);
  return l;
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
  const updated: Location = { ...existing, name: trimmed };
  await updateRow(TABS.Locations.name, id, [updated.id, updated.name, updated.created_at]);
  return updated;
}
export async function deleteLocation(id: string): Promise<void> {
  // Refuse to delete if any tournament still references this location —
  // otherwise the FK on those tournaments would silently dangle. The caller
  // (or user) should reassign or clear those tournaments first.
  const tournaments = await listTournaments();
  const refs = tournaments.filter(t => t.location_id === id);
  if (refs.length > 0) {
    throw new Error(
      `Cannot delete: ${refs.length} tournament${refs.length === 1 ? "" : "s"} still use this location`
    );
  }
  await deleteRow(TABS.Locations.name, id);
}

// ---------- Tournaments ----------
function tParse(r: any): Tournament {
  // `location_id` and `state` are later additions. Treat blank / missing
  // `location_id` as null (legacy import). For `state`, default to
  // "Finished" — every historic row pre-dating the state column is a
  // finished tournament by definition.
  const locRaw = r.location_id;
  const stateRaw = String(r.state ?? "").trim();
  const state: TournamentState = stateRaw === "Active" ? "Active" : "Finished";
  return {
    id: r.id,
    date: String(r.date),
    name: r.name,
    buy_in_amount: Number(r.buy_in_amount),
    payout_structure: r.payout_structure ? JSON.parse(r.payout_structure) : [],
    notes: r.notes || "",
    location_id: locRaw === "" || locRaw == null ? null : String(locRaw),
    state,
  };
}
function tRow(t: Tournament) {
  return [t.id, t.date, t.name, t.buy_in_amount, JSON.stringify(t.payout_structure), t.notes ?? "", t.location_id ?? "", t.state];
}
export async function listTournaments(): Promise<Tournament[]> {
  const rows = await getAll(TABS.Tournaments.name);
  return rowsToObjects(rows, TABS.Tournaments.header).map(tParse)
    .sort((a, b) => a.date < b.date ? 1 : -1);
}
export async function getTournament(id: string): Promise<Tournament | null> {
  const t = (await listTournaments()).find(t => t.id === id);
  return t ?? null;
}
export async function createTournament(input: Omit<Tournament, "id"> & { state?: TournamentState }): Promise<Tournament> {
  validatePayout(input.payout_structure);
  validateLocation(input.location_id);
  // Default to Finished so any pre-existing caller (one-off scripts, tests)
  // keeps the previous behaviour without needing to be updated. The UI's
  // "Start tournament" path passes state="Active" explicitly.
  const state: TournamentState = input.state === "Active" ? "Active" : "Finished";
  const t: Tournament = { ...input, id: uuid(), location_id: input.location_id ?? null, state };
  await append(TABS.Tournaments.name, tRow(t));
  return t;
}
export async function updateTournament(t: Tournament): Promise<Tournament> {
  validatePayout(t.payout_structure);
  validateLocation(t.location_id);
  const state: TournamentState = t.state === "Active" ? "Active" : "Finished";
  const next: Tournament = { ...t, location_id: t.location_id ?? null, state };
  await updateRow(TABS.Tournaments.name, next.id, tRow(next));
  return next;
}

function validateLocation(locationId: string | null | undefined) {
  // Tournaments require a location once locations exist as a concept.
  // Legacy rows imported from the original spreadsheet may still have a
  // blank `location_id` — we tolerate that on read but the editor refuses
  // to save them back without one, and any API client trying to create or
  // update without a location is rejected here as a defense-in-depth.
  if (!locationId || !String(locationId).trim()) {
    throw new Error("location_id is required");
  }
}

/**
 * Assign each finished tournament a 1-indexed order number based on date
 * ascending (oldest = #1), with the sheet's row order as a stable
 * tiebreaker. Active tournaments are deliberately excluded — they aren't
 * part of the official tournament history yet, so we don't want them
 * shifting the numbering of all the games that came after.
 */
export function computeTournamentOrderNumbers(tournaments: Tournament[]): Map<string, number> {
  const withIndex = tournaments
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.state === "Finished");
  withIndex.sort((a, b) => {
    if (a.t.date < b.t.date) return -1;
    if (a.t.date > b.t.date) return 1;
    return a.i - b.i;
  });
  const out = new Map<string, number>();
  withIndex.forEach((x, i) => out.set(x.t.id, i + 1));
  return out;
}

/**
 * Resolve the display name for a tournament. If the user supplied a name
 * we use it verbatim; otherwise we fall back to "Tournament #N" (for a
 * finished tournament with an order number) or "Active tournament" (for an
 * in-progress one). `order_number` is optional because Active rows don't
 * have one.
 */
export function displayTournamentName(t: { name?: string | null; order_number?: number | null; state?: TournamentState }): string {
  const n = (t.name ?? "").trim();
  if (n) return n;
  if (t.state === "Active") return "Active tournament";
  return t.order_number ? `Tournament #${t.order_number}` : "Tournament";
}
export async function deleteTournament(id: string) {
  // delete entries for this tournament first
  const entries = await listEntries();
  for (const e of entries.filter(e => e.tournament_id === id)) {
    await deleteRow(TABS.Entries.name, e.id);
  }
  await deleteRow(TABS.Tournaments.name, id);
}

function validatePayout(p: PayoutSlot[]) {
  if (!p.length) throw new Error("payout_structure cannot be empty");
  const sum = p.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(sum - 100) > 0.01) throw new Error(`payout_structure must sum to 100, got ${sum}`);
}

// ---------- Entries ----------
function eParse(r: any): Entry {
  return {
    id: r.id,
    tournament_id: r.tournament_id,
    player_id: r.player_id,
    buy_ins: Number(r.buy_ins || 0),
    finish_position: r.finish_position === "" || r.finish_position == null ? null : Number(r.finish_position),
    payout_override: r.payout_override === "" || r.payout_override == null ? null : Number(r.payout_override),
  };
}
function eRow(e: Entry) {
  return [e.id, e.tournament_id, e.player_id, e.buy_ins, e.finish_position ?? "", e.payout_override ?? ""];
}
export async function listEntries(): Promise<Entry[]> {
  const rows = await getAll(TABS.Entries.name);
  return rowsToObjects(rows, TABS.Entries.header).map(eParse);
}
export async function listEntriesFor(tournamentId: string): Promise<Entry[]> {
  return (await listEntries()).filter(e => e.tournament_id === tournamentId);
}
export async function createEntry(input: Omit<Entry, "id">): Promise<Entry> {
  const e: Entry = { ...input, id: uuid() };
  await append(TABS.Entries.name, eRow(e));
  return e;
}
export async function updateEntry(e: Entry): Promise<Entry> {
  await updateRow(TABS.Entries.name, e.id, eRow(e));
  return e;
}
export async function deleteEntry(id: string) {
  await deleteRow(TABS.Entries.name, id);
}

// ---------- Bulk save of entries (replace set for a tournament) ----------
export async function replaceEntriesFor(tournamentId: string, entries: Omit<Entry, "id" | "tournament_id">[]) {
  const existing = await listEntriesFor(tournamentId);
  for (const e of existing) await deleteRow(TABS.Entries.name, e.id);
  for (const inp of entries) {
    await createEntry({ ...inp, tournament_id: tournamentId });
  }
}

// ---------- Stats / computation ----------
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

export async function computePlayerStats(): Promise<PlayerStats[]> {
  const [players, allTournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
  // Active tournaments are excluded from every aggregation — they exist
  // for live tracking only and are not yet "real" results.
  const tournaments = allTournaments.filter(t => t.state === "Finished");
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

export async function computeCumulativeSeries(): Promise<{
  players: Player[];
  points: CumulativePoint[];
  latestTournamentPlayerIds: string[];
}> {
  const [players, allTournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
  // Same as in computePlayerStats: Active rows don't contribute to the
  // cumulative net curve until they finish.
  const tournaments = allTournaments.filter(t => t.state === "Finished");
  const tEntries = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!tEntries.has(e.tournament_id)) tEntries.set(e.tournament_id, []);
    tEntries.get(e.tournament_id)!.push(e);
  }
  const ordered = [...tournaments].sort((a, b) => a.date < b.date ? -1 : 1);
  const running = new Map<string, number>(players.map(p => [p.id, 0]));
  // Track first appearance per player so we can emit null before that point and
  // let the chart start each line on the player's first tournament instead of
  // drawing a flat zero baseline from the very first game.
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
  // Players who participated in the most recent tournament — used by the UI to
  // default-enable that subset of legend tags.
  const latestTournament = ordered[ordered.length - 1];
  const latestTournamentPlayerIds = latestTournament
    ? Array.from(new Set((tEntries.get(latestTournament.id) ?? []).map(e => e.player_id)))
    : [];
  return { players, points, latestTournamentPlayerIds };
}

/**
 * Aggregate top-level statistics for the Tournaments tab summary card.
 *
 * Pure function — takes already-filtered slices. To compute a different scope
 * (e.g. last 12 months), filter `tournaments` upstream and let the entries set
 * stay full (we filter entries by tournament id internally).
 *
 * Active tournaments are dropped here as a safety net so any call site that
 * forgets to pre-filter still produces the right "finished-only" stats.
 *
 * Tiebreaker for all "most X" leaderboard slots: highest count, ties broken
 * alphabetically by player name so display is stable.
 */
export function computeTournamentSummary(
  allTournaments: Tournament[],
  entries: Entry[],
  players: Player[],
): TournamentSummary {
  const tournaments = allTournaments.filter(t => t.state === "Finished");
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

  // Bucket entries by tournament, but only for the in-scope tournaments.
  const entriesByT = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!tournamentIds.has(e.tournament_id)) continue;
    if (!entriesByT.has(e.tournament_id)) entriesByT.set(e.tournament_id, []);
    entriesByT.get(e.tournament_id)!.push(e);
  }

  // Per-tournament aggregates.
  let totalPool = 0;
  let totalBuyIn = 0;
  let totalWinAmount = 0;
  let totalPlayerCount = 0;
  let winAmountSamples = 0;
  let biggestPool: TournamentSummary["biggest_pool"] = null;
  let biggestField: TournamentSummary["biggest_field"] = null;
  let biggestWin: TournamentSummary["biggest_win"] = null;

  // Per-player tallies used to compute the ITM-rate leaderboard slot.
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

    // Walk the computed entries: track ITM hits, appearance counts, and the
    // running max payout for the "biggest single win" tile.
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

  // Best ITM rate among players with >=5 appearances. Tie-break by higher
  // raw ITM count, then alphabetical name for stability.
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

// ---------- Bootstrap ----------
export async function ensureSchema() {
  const meta = await client().spreadsheets.get({ spreadsheetId: sheetId() });
  const titles = new Set((meta.data.sheets ?? []).map(s => s.properties?.title));
  const adds: sheets_v4.Schema$Request[] = [];
  for (const tab of Object.values(TABS)) {
    if (!titles.has(tab.name)) adds.push({ addSheet: { properties: { title: tab.name } } });
  }
  if (adds.length) {
    await client().spreadsheets.batchUpdate({ spreadsheetId: sheetId(), requestBody: { requests: adds } });
  }
  for (const tab of Object.values(TABS)) {
    const rows = await getAll(tab.name);
    const headerRow = rows[0] ?? [];
    // Rewrite the header when:
    //  - the tab is brand new (no rows yet), OR
    //  - the first cell doesn't match (someone manually broke the schema), OR
    //  - we've added new trailing columns since the sheet was provisioned
    //    (e.g. `location_id` on Tournaments). Reading by index treats the
    //    missing cells as empty, but the user-visible header in Sheets stays
    //    out of sync until we rewrite it.
    const needsRewrite =
      !rows.length ||
      headerRow[0] !== tab.header[0] ||
      headerRow.length < tab.header.length ||
      tab.header.some((h, i) => headerRow[i] !== h);
    if (needsRewrite) {
      await client().spreadsheets.values.update({
        spreadsheetId: sheetId(),
        range: `${tab.name}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [tab.header as unknown as string[]] },
      });
    }
  }
}
