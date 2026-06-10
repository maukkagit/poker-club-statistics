import type { Player } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapPlayer } from "./mappers";

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
