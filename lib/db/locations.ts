import type { Location } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapLocation, nowIso } from "./mappers";

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
  const locations = (data ?? []).map(mapLocation);

  // Order the dropdown by how often each location has been used (most-used
  // first), falling back to alphabetical order for ties / never-used rows.
  const { data: refs, error: refErr } = await supabase()
    .from("tournaments").select("location_id").is("deleted_at", null);
  if (refErr) throw new Error(refErr.message);
  const usage = new Map<string, number>();
  for (const r of refs ?? []) {
    const id = (r as { location_id: string | null }).location_id;
    if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  return locations.sort((a, b) => {
    const diff = (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
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
