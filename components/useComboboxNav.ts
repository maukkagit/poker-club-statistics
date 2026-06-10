"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Shared dropdown-navigation scaffolding for the typeahead comboboxes
 * (PlayerCombobox, LocationCombobox). Owns the open/highlight state, the three
 * refs, and the three behaviors that were duplicated verbatim between them:
 *  - clamp the highlighted index when the visible item count changes,
 *  - scroll the highlighted row into view while navigating by keyboard,
 *  - close on click-outside.
 *
 * Filtering, keyboard handling and rendering stay in each component since they
 * differ (alphabetical vs. create-row, controlled vs. uncontrolled).
 *
 * `onClose` runs in addition to closing when the user clicks outside (e.g. to
 * also clear the query). It is captured in a ref so passing an inline callback
 * doesn't re-subscribe the listener — matching the original `[open]`-only
 * effect dependency.
 */
export function useComboboxNav(itemCount: number, onClose?: () => void) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keep the highlighted row in bounds whenever the list shrinks or grows.
  useEffect(() => {
    if (highlight >= itemCount) setHighlight(Math.max(0, itemCount - 1));
  }, [itemCount, highlight]);

  // Auto-scroll the highlighted row into view when navigating with the keyboard.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        onCloseRef.current?.();
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return { open, setOpen, highlight, setHighlight, rootRef, inputRef, listRef };
}
