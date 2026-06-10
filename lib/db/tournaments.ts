import type { PayoutSlot, Tournament, TournamentState } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapTournament, nowIso } from "./mappers";

// ---------- Validation ----------
export function validatePayout(p: PayoutSlot[]) {
  if (!p.length) throw new Error("payout_structure cannot be empty");
  const sum = p.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(sum - 100) > 0.01) throw new Error(`payout_structure must sum to 100, got ${sum}`);
}

export function validateLocation(locationId: string | null | undefined) {
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
export function compareTournamentsByDate<T extends { date: string; created_at: string }>(
  a: T, b: T, dir: "asc" | "desc" = "asc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * sign;
  const ac = a.created_at || "";
  const bc = b.created_at || "";
  if (ac !== bc) return (ac < bc ? -1 : 1) * sign;
  return 0;
}

// ---------- CRUD ----------
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
