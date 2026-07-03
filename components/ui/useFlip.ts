"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * FLIP ("First, Last, Invert, Play") animation for a set of elements that
 * reflow between positions — e.g. legend pills moving between a "selected" and
 * an "unselected" group. Elements visibly fly from where they were to where
 * they end up instead of teleporting, even when they hop between containers.
 *
 * Usage:
 *   const { register, snapshot } = useFlip();
 *   // record positions right before the state change that moves things:
 *   const toggle = (id) => { snapshot(); setState(...); };
 *   // register each animated node by a STABLE id:
 *   <button ref={register(id)} onClick={() => toggle(id)} />
 *
 * How it works: `snapshot()` stores each node's viewport rect. After the next
 * commit, a layout effect measures the new rects, applies an inverse transform
 * instantly (so it appears unmoved), then releases it on the next frame — the
 * browser tweens it to its real spot. Honours `prefers-reduced-motion`.
 */
export function useFlip(durationMs = 340) {
  const reduced = useReducedMotion();
  const nodes = useRef<Map<string, HTMLElement>>(new Map());
  const prev = useRef<Map<string, DOMRect>>(new Map());

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );

  const snapshot = useCallback(() => {
    if (reduced) return;
    const m = new Map<string, DOMRect>();
    nodes.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()));
    prev.current = m;
  }, [reduced]);

  useLayoutEffect(() => {
    const before = prev.current;
    if (before.size === 0) return;
    prev.current = new Map();
    nodes.current.forEach((el, id) => {
      const b = before.get(id);
      if (!b) return;
      const a = el.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      // Skip nodes that didn't move or aren't laid out (e.g. a collapsed,
      // display:none group on mobile).
      if ((dx === 0 && dy === 0) || (a.width === 0 && a.height === 0)) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Force a reflow so the browser paints the inverted position before we
      // release it — without this the transition has nothing to animate from.
      void el.getBoundingClientRect();
      requestAnimationFrame(() => {
        // A gentle overshoot — the pill nudges slightly past its target and
        // settles. Milder than the full spring token (y2 1.2 vs 1.56).
        el.style.transition = `transform ${durationMs}ms cubic-bezier(0.34, 1.2, 0.64, 1)`;
        el.style.transform = "";
      });
    });
  });

  return { register, snapshot };
}
