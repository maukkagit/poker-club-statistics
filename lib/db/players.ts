import type { Player } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapPlayer } from "./mappers";

export async function listPlayers(): Promise<Player[]> {
  const { data, error } = await supabase()
    .from("players").select("*").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPlayer);
}

/** Map of player id -> display name for the given ids (missing ids are skipped). */
export async function getPlayerNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase()
    .from("players").select("id,name").in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map(r => [String(r.id), String(r.name ?? "")]));
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
