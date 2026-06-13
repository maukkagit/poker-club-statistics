"use client";
import { useBroadcastChannel } from "@/components/useBroadcastChannel";
import { chatChannel, CHAT_EVENT } from "@/lib/clock-channel";

/**
 * Subscribe to a tournament's realtime chat channel and run `onChanged` on
 * every broadcast (a new/pinned message), so the viewer feed updates near-
 * instantly. No-ops without a token or browser Supabase client; the caller's
 * polling keeps things fresh either way.
 */
export function useChatChannel(token: string | null | undefined, onChanged: () => void) {
  useBroadcastChannel(token ? chatChannel(token) : null, CHAT_EVENT, onChanged);
}
