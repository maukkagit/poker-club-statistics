"use client";
import { useEffect, useMemo, useState } from "react";
import { seatingDefaults, tablesFor, MAX_SEATS_PER_TABLE } from "@/lib/seating";
import { buildDrawResult, type DrawPlayerInfo, type DrawResult } from "@/lib/seat-draw";

/**
 * All seat-draw state + handlers for SeatDrawPanel, extracted so the panel is
 * purely presentational. Behaviour is identical to the previous inline logic:
 *
 *  - Any config change discards a prior draw (`invalidate`) so the parent
 *    can't confirm a stale seating.
 *  - `autoDraw` performs a single mount-only draw for the re-draw entry points
 *    (deliberately runs once; see the empty-deps effect below).
 */
export function useSeatDrawState({
  players, onResult, autoDraw = false, defaultSeatsPerTable, onSeatsPerTableChange,
}: {
  players: DrawPlayerInfo[];
  onResult: (r: DrawResult | null) => void;
  autoDraw?: boolean;
  defaultSeatsPerTable?: number;
  onSeatsPerTableChange?: (n: number) => void;
}) {
  const defaults = useMemo(() => seatingDefaults(players.length), [players.length]);
  const initialSpt = defaultSeatsPerTable ?? defaults.seats_per_table;
  const [tables, setTables] = useState<number>(
    defaultSeatsPerTable != null ? tablesFor(players.length, initialSpt) : defaults.tables,
  );
  const [seatsPerTable, setSeatsPerTable] = useState<number>(initialSpt);
  const [bucketsEnabled, setBucketsEnabled] = useState<boolean>(players.some(p => p.bucket != null));
  const [buckets, setBuckets] = useState<Record<string, number | "">>(() => {
    const m: Record<string, number | ""> = {};
    for (const p of players) m[p.player_id] = p.bucket ?? "";
    return m;
  });
  const [result, setResult] = useState<DrawResult | null>(null);

  const capacity = tables * seatsPerTable;
  const overCapacity = players.length > capacity;
  const canDraw = players.length >= 2 && tables >= 1 && seatsPerTable >= 1 && !overCapacity;

  // Any config change discards the prior draw so the parent can't confirm a
  // stale seating that no longer matches the inputs.
  function invalidate() {
    if (result) { setResult(null); onResult(null); }
  }

  function onTablesChange(n: number | null) {
    setTables(Math.max(1, n ?? 1));
    invalidate();
  }

  function onSeatsChange(n: number | null) {
    const v = Math.min(MAX_SEATS_PER_TABLE, Math.max(2, n ?? 2));
    setSeatsPerTable(v);
    onSeatsPerTableChange?.(v);
    invalidate();
  }

  function onBucketsEnabledChange(next: boolean) {
    setBucketsEnabled(next);
    invalidate();
  }

  function onBucketChange(playerId: string, n: number | null) {
    setBuckets(b => ({ ...b, [playerId]: n ?? "" }));
    invalidate();
  }

  function doDraw() {
    if (!canDraw) return;
    const r = buildDrawResult({ players, tables, seatsPerTable, bucketsEnabled, buckets });
    setResult(r);
    onResult(r);
  }

  // Optional initial draw (re-draw entry points open already-drawn).
  useEffect(() => {
    if (autoDraw && !result && canDraw) doDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    tables, seatsPerTable, bucketsEnabled, buckets, result,
    capacity, overCapacity, canDraw,
    onTablesChange, onSeatsChange, onBucketsEnabledChange, onBucketChange, doDraw,
  };
}
