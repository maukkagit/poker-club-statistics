import type { Entry, Player, Tournament } from "@/lib/types";

// Minimal builders for domain objects used by the characterization tests.
// Defaults match the live-tournament fields' "legacy row" behavior so a plain
// finished tournament needs almost no boilerplate.

export function makePlayer(id: string, name: string): Player {
  return { id, name, created_at: "2026-01-01T00:00:00Z" };
}

export function makeTournament(over: Partial<Tournament> & { id: string }): Tournament {
  return {
    id: over.id,
    date: over.date ?? "2026-01-01",
    name: over.name ?? "",
    buy_in_amount: over.buy_in_amount ?? 30,
    payout_structure: over.payout_structure ?? [{ position: 1, pct: 100 }],
    notes: over.notes ?? "",
    location_id: over.location_id ?? null,
    state: over.state ?? "Finished",
    special: over.special ?? false,
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    seating: over.seating ?? null,
    rebuys_allowed: over.rebuys_allowed ?? true,
    rebuy_window_open: over.rebuy_window_open ?? true,
    version: over.version ?? 0,
    payout_overrides: over.payout_overrides ?? null,
  };
}

export function makeEntry(over: Partial<Entry> & { id: string; tournament_id: string; player_id: string }): Entry {
  return {
    id: over.id,
    tournament_id: over.tournament_id,
    player_id: over.player_id,
    buy_ins: over.buy_ins ?? 1,
    finish_position: over.finish_position ?? null,
    payout_override: over.payout_override ?? null,
    table_no: over.table_no ?? null,
    seat_no: over.seat_no ?? null,
    bucket: over.bucket ?? null,
  };
}
