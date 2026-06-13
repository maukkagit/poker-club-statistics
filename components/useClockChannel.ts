"use client";
import { useBroadcastChannel } from "@/components/useBroadcastChannel";
import { clockChannel, CLOCK_EVENT } from "@/lib/clock-channel";

/**
 * Subscribe to a tournament's realtime clock channel and run `onChanged` on
 * every broadcast (typically a SWR `mutate` to refetch). No-ops when there's no
 * token or the browser Supabase client isn't configured — the caller's polling
 * keeps things fresh either way.
 */
export function useClockChannel(token: string | null | undefined, onChanged: () => void) {
  useBroadcastChannel(token ? clockChannel(token) : null, CLOCK_EVENT, onChanged);
}
