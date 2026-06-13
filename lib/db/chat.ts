import type { ChatMessage } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { mapChatMessage } from "./mappers";

/** Max messages returned per tournament feed (oldest dropped beyond this). */
const FEED_LIMIT = 300;

/** All chat messages for a tournament, oldest first (chat-feed order). */
export async function listChatMessages(tournamentId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase()
    .from("chat_messages")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);
  if (error) throw new Error(error.message);
  // Fetched newest-first (so the limit keeps the most recent), returned oldest-first.
  return (data ?? []).map(mapChatMessage).reverse();
}

/** Insert a new chat message (caller has already validated/clamped the input). */
export async function addChatMessage(
  tournamentId: string, authorName: string, body: string,
): Promise<ChatMessage> {
  const { data, error } = await supabase()
    .from("chat_messages")
    .insert({ tournament_id: tournamentId, author_name: authorName, body })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapChatMessage(data);
}

/**
 * Make `messageId` the single pinned message for the tournament, or unpin
 * everything when `messageId` is null. Atomic via the `set_pinned_chat_message`
 * RPC so the one-pin-per-tournament unique index is never violated.
 */
export async function setPinnedChatMessage(tournamentId: string, messageId: string | null): Promise<void> {
  const { error } = await supabase().rpc("set_pinned_chat_message", {
    p_tournament_id: tournamentId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
}
