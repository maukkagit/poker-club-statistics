import { google, sheets_v4 } from "googleapis";
import { v4 as uuid } from "uuid";
import type { Entry, Player, Tournament, PayoutSlot, ComputedEntry, PlayerStats } from "./types";

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
  Tournaments: { name: "Tournaments", header: ["id", "date", "name", "buy_in_amount", "payout_structure", "notes"] },
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
export async function deletePlayer(id: string) {
  await deleteRow(TABS.Players.name, id);
}

// ---------- Tournaments ----------
function tParse(r: any): Tournament {
  return {
    id: r.id,
    date: String(r.date),
    name: r.name,
    buy_in_amount: Number(r.buy_in_amount),
    payout_structure: r.payout_structure ? JSON.parse(r.payout_structure) : [],
    notes: r.notes || "",
  };
}
function tRow(t: Tournament) {
  return [t.id, t.date, t.name, t.buy_in_amount, JSON.stringify(t.payout_structure), t.notes ?? ""];
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
export async function createTournament(input: Omit<Tournament, "id">): Promise<Tournament> {
  validatePayout(input.payout_structure);
  const t: Tournament = { ...input, id: uuid() };
  await append(TABS.Tournaments.name, tRow(t));
  return t;
}
export async function updateTournament(t: Tournament): Promise<Tournament> {
  validatePayout(t.payout_structure);
  await updateRow(TABS.Tournaments.name, t.id, tRow(t));
  return t;
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
  const [players, tournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
  const byT = new Map(tournaments.map(t => [t.id, t]));
  const acc = new Map<string, PlayerStats>();
  for (const p of players) acc.set(p.id, {
    player_id: p.id, name: p.name, tournaments: 0, total_buy_ins: 0,
    total_cost: 0, total_winnings: 0, net_profit: 0, avg_net: 0,
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
  const [players, tournaments, entries] = await Promise.all([listPlayers(), listTournaments(), listEntries()]);
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
    if (!rows.length || (rows[0] && rows[0][0] !== tab.header[0])) {
      await client().spreadsheets.values.update({
        spreadsheetId: sheetId(),
        range: `${tab.name}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [tab.header as unknown as string[]] },
      });
    }
  }
}
