"use client";
import { useEffect, useRef } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

/**
 * Subscribe to a Supabase Realtime broadcast `channel`/`event` and run
 * `onChanged` on every message (typically a SWR `mutate` to refetch). No-ops
 * when there's no channel or the browser Supabase client isn't configured — the
 * caller's polling keeps things fresh either way.
 *
 * `onChanged` is held in a ref so the subscription only re-establishes when the
 * channel/event changes, not on every render.
 */
export function useBroadcastChannel(
  channel: string | null | undefined,
  event: string,
  onChanged: () => void,
) {
  const cb = useRef(onChanged);
  cb.current = onChanged;

  useEffect(() => {
    if (!channel) return;
    const sb = browserSupabase();
    if (!sb) return;
    const ch = sb
      .channel(channel)
      .on("broadcast", { event }, () => cb.current())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [channel, event]);
}
