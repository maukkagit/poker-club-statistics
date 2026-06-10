"use client";
import { useEffect, useMemo, useState } from "react";
import {
  seatingDefaults, drawSeats, tablesFor, MAX_SEATS_PER_TABLE,
  type SeatAssignment,
} from "@/lib/seating";
import type { Seating } from "@/lib/types";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import PokerTable, { type TableOccupant } from "@/components/PokerTable";

export type DrawPlayerInfo = { player_id: string; name: string; bucket?: number | null };

export type DrawResult = {
  seating: Seating;
  assignments: { player_id: string; table_no: number; seat_no: number }[];
  // The bucket actually applied per player for this draw (empty when buckets
  // were off). Persisted onto entries.bucket so re-draws keep the same tiers.
  bucketByPlayerId: Record<string, number>;
};

/**
 * Seat-draw configuration + preview. Lets the director pick the number of
 * tables and seats-per-table (capped at 10), optionally assign performance
 * buckets, then Draw (and re-draw) a seating. The actual maths is the pure
 * `drawSeats` from `lib/seating`. The drawn result is handed to the parent via
 * `onResult`; changing any input invalidates a prior draw (`onResult(null)`).
 *
 * This component does NOT persist anything — the wizard keeps the result in
 * client state until Confirm, and the Active page posts it via the assign_seats
 * RPC. Same preview, same maths, both paths.
 */
export default function SeatDrawPanel({
  players, onResult, autoDraw = false, defaultSeatsPerTable, onSeatsPerTableChange,
}: {
  players: DrawPlayerInfo[];
  onResult: (r: DrawResult | null) => void;
  // When true, perform an initial draw on mount (used for re-draw flows).
  autoDraw?: boolean;
  // Initial seats-per-table (the table format). Defaults to a sensible value
  // for the field size. The input stays editable (integer, 2..MAX).
  defaultSeatsPerTable?: number;
  // Notified whenever the seats-per-table changes, so a parent (the wizard) can
  // mirror it for the "skip the draw" path.
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

  const nameById = useMemo(() => new Map(players.map(p => [p.player_id, p.name])), [players]);
  const capacity = tables * seatsPerTable;
  const overCapacity = players.length > capacity;
  const canDraw = players.length >= 2 && tables >= 1 && seatsPerTable >= 1 && !overCapacity;

  // Any config change discards the prior draw so the parent can't confirm a
  // stale seating that no longer matches the inputs.
  function invalidate() {
    if (result) { setResult(null); onResult(null); }
  }

  function doDraw() {
    if (!canDraw) return;
    const bucketByPlayerId: Record<string, number> = {};
    if (bucketsEnabled) {
      for (const p of players) {
        const b = buckets[p.player_id];
        if (b !== "" && b != null && Number.isFinite(Number(b))) bucketByPlayerId[p.player_id] = Number(b);
      }
    }
    const usingBuckets = bucketsEnabled && Object.keys(bucketByPlayerId).length > 0;
    const assignments: SeatAssignment[] = drawSeats(
      players.map(p => ({ player_id: p.player_id })),
      tables, seatsPerTable,
      () => Math.random(),
      usingBuckets ? { bucketByPlayerId } : undefined,
    );
    // Button defaults to seat 1 on every table; the director can adjust the
    // button live during rebalancing.
    const buttonsObj: Record<string, number> = {};
    for (let t = 1; t <= tables; t++) buttonsObj[String(t)] = 1;
    const seating: Seating = {
      tables,
      seats_per_table: seatsPerTable,
      buckets_used: usingBuckets,
      buttons: buttonsObj,
      drawn_at: new Date().toISOString(),
    };
    const r: DrawResult = { seating, assignments, bucketByPlayerId: usingBuckets ? bucketByPlayerId : {} };
    setResult(r);
    onResult(r);
  }

  // Optional initial draw (re-draw entry points open already-drawn).
  useEffect(() => {
    if (autoDraw && !result && canDraw) doDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byTable = useMemo(() => {
    const m = new Map<number, TableOccupant[]>();
    if (!result) return m;
    for (const a of result.assignments) {
      if (!m.has(a.table_no)) m.set(a.table_no, []);
      m.get(a.table_no)!.push({ player_id: a.player_id, name: nameById.get(a.player_id) ?? "?", seat_no: a.seat_no });
    }
    return m;
  }, [result, nameById]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="label">Tables</label>
          <NumberInput
            className="input"
            value={tables}
            onChange={n => { setTables(Math.max(1, n ?? 1)); invalidate(); }}
          />
        </div>
        <div className="min-w-0">
          <label className="label">Seats per table <span className="muted font-normal">(2–{MAX_SEATS_PER_TABLE})</span></label>
          <NumberInput
            className="input"
            value={seatsPerTable}
            min={2}
            max={MAX_SEATS_PER_TABLE}
            onChange={n => {
              const v = Math.min(MAX_SEATS_PER_TABLE, Math.max(2, n ?? 2));
              setSeatsPerTable(v);
              onSeatsPerTableChange?.(v);
              invalidate();
            }}
          />
        </div>
      </div>

      <div>
        <Toggle
          checked={bucketsEnabled}
          onChange={next => { setBucketsEnabled(next); invalidate(); }}
          label="Use performance buckets"
          size="sm"
          labelPosition="right"
          className="text-sm"
        />
        <p className="muted text-xs leading-snug mt-1">
          Spread each tier evenly across tables (e.g. top third, middle third, bottom third). Any positive integers; uneven groups are fine.
        </p>
      </div>

      {bucketsEnabled && (
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {players.map(p => (
              <div key={p.player_id} className="flex items-center justify-between gap-2">
                <span className="text-sm truncate">{p.name}</span>
                <NumberInput
                  className="input w-16 shrink-0"
                  value={buckets[p.player_id] === "" ? null : (buckets[p.player_id] as number)}
                  emptyBlurBehavior="null"
                  placeholder="—"
                  onChange={n => { setBuckets(b => ({ ...b, [p.player_id]: n ?? "" })); invalidate(); }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {overCapacity && (
        <div className="card neg text-sm">
          {players.length} players don&apos;t fit in {tables} × {seatsPerTable} = {capacity} seats. Add tables or seats.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn whitespace-nowrap" onClick={doDraw} disabled={!canDraw}>
          {result ? "Re-draw seats" : "Draw seats"}
        </button>
        {result && (
          <span className="muted text-sm">
            {result.assignments.length} players seated across {tables} table{tables === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...byTable.entries()].sort((a, b) => a[0] - b[0]).map(([tno, occ]) => (
            <div key={tno} className="card">
              <PokerTable tableNo={tno} occupants={occ} seats={seatsPerTable} buttonSeat={result.seating.buttons[String(tno)] ?? 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
