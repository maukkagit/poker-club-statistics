"use client";
import { useMemo, useState } from "react";

/**
 * Shared, reusable column sorting for data tables — the same interaction the
 * dashboard's player-stats leaderboard uses (click a header to sort, click
 * again to flip direction). Two pieces:
 *
 *   - `useSortable(rows, getValue, options)` — returns the sorted rows plus the
 *     current sort key/direction and an `onSort` handler.
 *   - `<SortableTh>` — a clickable `<th>` with an ▲/▼ indicator.
 *
 * `getValue(row, key)` returns the comparable value for a column. Returning
 * `null` (or `undefined`) pins that row to the bottom regardless of direction —
 * used for "no data" cells like an unplayed player's ROI or a missing finish
 * position, so an ascending sort doesn't float empties to the top.
 */
export type SortDir = "asc" | "desc";

type SortValue = number | string | null | undefined;

export function useSortable<T>(
  rows: T[],
  getValue: (row: T, key: string) => SortValue,
  options: {
    initialKey: string;
    initialDir?: SortDir;
    /** Per-column default direction applied when a column is first activated. */
    defaultDirs?: Record<string, SortDir>;
    /** Stable tiebreaker when two rows compare equal (e.g. by name). */
    tiebreak?: (a: T, b: T) => number;
  },
) {
  const { initialKey, initialDir, defaultDirs, tiebreak } = options;
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(
    initialDir ?? defaultDirs?.[initialKey] ?? "desc",
  );

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(defaultDirs?.[key] ?? "desc"); }
  };

  const sorted = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getValue(a, sortKey);
      const vb = getValue(b, sortKey);
      const aNull = va == null;
      const bNull = vb == null;
      // Missing values always sink to the bottom, independent of direction.
      if (aNull || bNull) {
        if (aNull && bNull) return tiebreak ? tiebreak(a, b) : 0;
        return aNull ? 1 : -1;
      }
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
      return tiebreak ? tiebreak(a, b) : 0;
    });
    // `getValue`/`tiebreak` are pure over their args; intentionally excluded so
    // a fresh closure each render doesn't force a needless re-sort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, onSort };
}

export function SortableTh({
  k, label, align, className, sortKey, sortDir, onSort,
}: {
  k: string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  sortKey: string;
  sortDir: SortDir;
  onSort: (k: string) => void;
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  const alignRight = align === "right";
  const alignCenter = align === "center";
  const alignClass = alignRight ? "text-right" : alignCenter ? "text-center" : "";
  // Fixed-width arrow slot so column widths don't shift when the active sort
  // toggles, and so the slot stays the same width whether or not it holds an
  // arrow. `shrink-0` is essential: as a flex child the slot would otherwise
  // collapse to its (zero) min-content when empty but hold the glyph's width
  // when active, growing the column on sort. Pinning shrink to 0 keeps the
  // declared width reserved in both states.
  const arrowSlot = (
    <span className="inline-block w-2 shrink-0 text-center text-[0.6em] leading-none">{arrow}</span>
  );
  // Arrow placement keeps the LABEL aligned to the same edge as the body cells:
  //  - right-aligned: arrow before the label (label hugs the right edge).
  //  - left-aligned:  arrow after the label (label hugs the left edge).
  //  - center:        an equal-width spacer on the left balances the arrow slot
  //    on the right, so the label stays truly centred over the centered cells
  //    below instead of being nudged left by the arrow's width.
  const spacer = <span className="inline-block w-2 shrink-0" aria-hidden="true" />;
  const justify = alignRight ? "justify-end" : alignCenter ? "justify-center" : "justify-start";
  return (
    <th
      className={[alignClass, className].filter(Boolean).join(" ")}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        // p-0 overrides the user-agent default button padding so the header
        // label hugs the same edge as the body cells.
        className={`inline-flex items-center gap-1 ${justify} w-full p-0 select-none hover:text-[var(--text)]`}
      >
        {alignRight && arrowSlot}
        {alignCenter && spacer}
        <span>{label}</span>
        {!alignRight && arrowSlot}
      </button>
    </th>
  );
}
