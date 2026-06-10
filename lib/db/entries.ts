import type { Entry } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapEntry } from "./mappers";

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
