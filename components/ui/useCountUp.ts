"use client";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Smoothly tweens a displayed number toward `value` using requestAnimationFrame
 * and an ease-out curve. Great for figures that jump on live updates (prize
 * pool, chip counts, player totals) — the eye tracks the roll instead of a
 * hard snap.
 *
 * Notes:
 *  - The first render shows the real value instantly (no count-up from 0 on
 *    mount, which would look like a glitch on every page load).
 *  - Honours `prefers-reduced-motion` by snapping to the target.
 *  - Returns a number; format it at the call site (eur(), toLocaleString()).
 */
export function useCountUp(value: number, durationMs = 600): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip the animation on the very first commit and when motion is reduced.
    if (!mountedRef.current || reduced) {
      mountedRef.current = true;
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOut(t);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // If interrupted, treat the current target as the new baseline.
      fromRef.current = value;
    };
  }, [value, durationMs, reduced]);

  return display;
}
