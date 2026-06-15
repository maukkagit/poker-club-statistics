import type { Knockout } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapKnockout } from "./mappers";

/** All knockouts for one tournament, oldest first (ledger / derivation order). */
export async function listKnockoutsFor(tournamentId: string): Promise<Knockout[]> {
  const { data, error } = await supabase()
    .from("knockouts")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true })
    .order("bust_event_id", { ascending: true })
    .order("split_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapKnockout);
}

/** Every knockout across all tournaments (used by the stats pipeline). */
export async function listKnockouts(): Promise<Knockout[]> {
  const { data, error } = await supabase()
    .from("knockouts")
    .select("*")
    .order("created_at", { ascending: true })
    .order("bust_event_id", { ascending: true })
    .order("split_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapKnockout);
}
