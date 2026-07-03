"use client";
import { useEffect, useState } from "react";

/**
 * Tracks the OS "reduce motion" accessibility setting. Animation hooks use
 * this to skip tweening (they jump straight to the final value) so the app
 * honours the same preference the global CSS guard enforces for pure-CSS
 * animations. SSR-safe: assumes motion is allowed until mounted.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
