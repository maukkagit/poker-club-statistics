"use client";
import { useCallback } from "react";
import type { PointerEvent } from "react";

/**
 * Material-style tap ripple. Returns a pointer-down handler that spawns an
 * ink span at the click point inside the target element. The element must be
 * `position: relative; overflow: hidden` — add the `ripple` utility class from
 * globals.css, which sets both.
 *
 *   const ripple = useRipple();
 *   <button className="btn ripple" onPointerDown={ripple}>…</button>
 *
 * The span removes itself when its animation ends, so no cleanup state is kept.
 * Skips when the user prefers reduced motion.
 */
export function useRipple() {
  return useCallback((e: PointerEvent<HTMLElement>) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ink = document.createElement("span");
    ink.className = "ripple-ink";
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - rect.left - size / 2}px`;
    ink.style.top = `${e.clientY - rect.top - size / 2}px`;
    ink.addEventListener("animationend", () => ink.remove());
    el.appendChild(ink);
  }, []);
}
