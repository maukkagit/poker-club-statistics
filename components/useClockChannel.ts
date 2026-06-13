"use client";
import { useEffect, useRef } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { clockChannel, CLOCK_EVENT } from "@/lib/clock-channel";

/**
 * Subscribe to a tournament's realtime clock channel and run `onChanged` on
 * every broadcast (typically a SWR `mutate` to refetch). No-ops when there's no
 * token or the browser Supabase client isn't configured — the caller's polling
 * keeps things fresh either way.
 *
 * `onChanged` is held in a ref so the subscription only re-establishes when the
 * token changes, not on every render.
 */
export function useClockChannel(token: string | null | undefined, onChanged: () => void) {
  const cb = useRef(onChanged);
  cb.current = onChanged;

  useEffect(() => {
    if (!token) return;
    const sb = browserSupabase();
    if (!sb) return;
    const channel = sb
      .channel(clockChannel(token))
      .on("broadcast", { event: CLOCK_EVENT }, () => cb.current())
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [token]);
}
