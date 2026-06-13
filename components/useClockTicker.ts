"use client";
import { useEffect, useState } from "react";

/**
 * Returns the current wall-clock time in ms, refreshed on an interval, so a
 * countdown derived from server timestamps animates smoothly without re-fetching.
 * Pass `active=false` (e.g. when the clock is paused or not started) to stop the
 * ticking and save renders.
 */
export function useClockTicker(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Always sync once on mount / when activity changes so a paused value is current.
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
