// Row mappers (Postgres row -> domain type) and small shared helpers.
// PostgREST already returns jsonb as objects, booleans as booleans and
// timestamps as ISO strings, so these are mostly defensive coercions to match
// the existing domain types exactly.
import type { Entry, Location, Player, Tournament, Seating } from "@/lib/types";

export function mapPlayer(r: any): Player {
  return { id: r.id, name: r.name, created_at: r.created_at };
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
