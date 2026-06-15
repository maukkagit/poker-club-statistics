// Row mappers (Postgres row -> domain type) and small shared helpers.
// PostgREST already returns jsonb as objects, booleans as booleans and
// timestamps as ISO strings, so these are mostly defensive coercions to match
// the existing domain types exactly.
import type {
  Entry, Location, Player, Tournament, Seating, StructureRow, TournamentClock, ChatMessage,
} from "@/lib/types";

export function mapPlayer(r: any): Player {
  return { id: r.id, name: r.name, created_at: r.created_at };
}

export function mapChatMessage(r: any): ChatMessage {
  return {
    id: r.id,
    tournament_id: r.tournament_id,
    author_name: String(r.author_name ?? ""),
    body: String(r.body ?? ""),
    pinned: Boolean(r.pinned),
    system: Boolean(r.system),
    created_at: r.created_at ?? "",
  };
}

export function mapLocation(r: any): Location {
  return { id: r.id, name: r.name, created_at: r.created_at };
}

export function mapTournament(r: any): Tournament {
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
    // Live-tournament fields (issue #20). Tolerate rows from before the 0002
    // migration: `seating` stays null, the booleans default sensibly, version 0.
    seating: parseSeating(r.seating),
    rebuys_allowed: r.rebuys_allowed == null ? true : Boolean(r.rebuys_allowed),
    rebuy_window_open: r.rebuy_window_open == null ? true : Boolean(r.rebuy_window_open),
    version: r.version == null ? 0 : Number(r.version),
    payout_overrides: parsePayoutOverrides(r.payout_overrides),
    // Tournament clock fields (issue #21). Tolerate pre-0004 rows: structure
    // empty, stack null, clock null, token null.
    structure: parseStructure(r.structure),
    starting_stack: r.starting_stack == null ? null : Number(r.starting_stack),
    clock: parseClock(r.clock),
    share_token: r.share_token == null ? null : String(r.share_token),
  };
}

/** Coerce the `structure` jsonb into a clean StructureRow[] (drops bad rows). */
export function parseStructure(v: any): StructureRow[] {
  const arr = typeof v === "string" ? safeJson(v) : v;
  if (!Array.isArray(arr)) return [];
  const out: StructureRow[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const duration_min = Number(row.duration_min);
    if (!Number.isFinite(duration_min) || duration_min <= 0) continue;
    if (row.kind === "break") {
      out.push({ kind: "break", duration_min });
    } else {
      out.push({
        kind: "level",
        sb: Number(row.sb ?? 0),
        bb: Number(row.bb ?? 0),
        ante: Number(row.ante ?? 0),
        duration_min,
      });
    }
  }
  return out;
}

/** Coerce the `clock` jsonb into a TournamentClock, or null when absent. */
export function parseClock(v: any): TournamentClock | null {
  if (!v) return null;
  const o = typeof v === "string" ? safeJson(v) : v;
  if (!o || typeof o !== "object") return null;
  return {
    started: Boolean(o.started),
    running: Boolean(o.running),
    elapsed_ms: Number(o.elapsed_ms ?? 0),
    updated_at: o.updated_at ? String(o.updated_at) : null,
  };
}

export function parsePayoutOverrides(v: any): Record<string, number> | null {
  if (!v) return null;
  const o = typeof v === "string" ? safeJson(v) : v;
  if (!o || typeof o !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(o)) {
    const n = Number(val);
    if (Number.isFinite(n)) out[String(k)] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function parseSeating(v: any): Seating | null {
  if (!v) return null;
  const o = typeof v === "string" ? safeJson(v) : v;
  if (!o || typeof o !== "object") return null;
  return {
    tables: Number(o.tables ?? 0),
    seats_per_table: Number(o.seats_per_table ?? 0),
    buckets_used: Boolean(o.buckets_used),
    buttons: (o.buttons && typeof o.buttons === "object") ? o.buttons : {},
    drawn_at: String(o.drawn_at ?? ""),
  };
}

export function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

export function mapEntry(r: any): Entry {
  return {
    id: r.id,
    tournament_id: r.tournament_id,
    player_id: r.player_id,
    buy_ins: Number(r.buy_ins ?? 0),
    finish_position: r.finish_position == null ? null : Number(r.finish_position),
    payout_override: r.payout_override == null ? null : Number(r.payout_override),
    table_no: r.table_no == null ? null : Number(r.table_no),
    seat_no: r.seat_no == null ? null : Number(r.seat_no),
    bucket: r.bucket == null ? null : Number(r.bucket),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
