"use client";
import { useMemo, useRef } from "react";
import { MAX_SEATS_PER_TABLE } from "@/lib/seating";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { type TableOccupant } from "@/components/PokerTable";
import SeatDrawReveal from "@/components/SeatDrawReveal";
import { useSeatDrawState } from "@/components/useSeatDrawState";
import type { DrawPlayerInfo, DrawResult } from "@/lib/seat-draw";

// Re-exported so existing importers (wizard, live manager) keep their paths.
export type { DrawPlayerInfo, DrawResult } from "@/lib/seat-draw";

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
  const {
    tables, seatsPerTable, bucketsEnabled, buckets, result,
    capacity, overCapacity, canDraw,
    onTablesChange, onSeatsChange, onBucketsEnabledChange, onBucketChange, doDraw,
  } = useSeatDrawState({ players, onResult, autoDraw, defaultSeatsPerTable, onSeatsPerTableChange });

  const nameById = useMemo(() => new Map(players.map(p => [p.player_id, p.name])), [players]);

  const sortedTables = useMemo(() => {
    const m = new Map<number, TableOccupant[]>();
    if (!result) return [] as [number, TableOccupant[]][];
    for (const a of result.assignments) {
      if (!m.has(a.table_no)) m.set(a.table_no, []);
      m.get(a.table_no)!.push({ player_id: a.player_id, name: nameById.get(a.player_id) ?? "?", seat_no: a.seat_no });
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [result, nameById]);

  // Bump a key on each fresh draw so SeatDrawReveal restarts its animation and
  // replays from the hidden start state. Deriving this during render (rather
  // than via an effect) means the tables' first paint is already in the reveal
  // state — the settled "everyone seated" end-state never flashes first.
  const drawSeqRef = useRef(0);
  const prevResultRef = useRef<DrawResult | null>(null);
  if (result !== prevResultRef.current) {
    prevResultRef.current = result;
    if (result) drawSeqRef.current += 1;
  }
  const drawSeq = drawSeqRef.current;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="label">Tables</label>
          <NumberInput
            className="input"
            value={tables}
            onChange={onTablesChange}
          />
        </div>
        <div className="min-w-0">
          <label className="label">Seats per table <span className="muted font-normal">(2–{MAX_SEATS_PER_TABLE})</span></label>
          <NumberInput
            className="input"
            value={seatsPerTable}
            min={2}
            max={MAX_SEATS_PER_TABLE}
            onChange={onSeatsChange}
          />
        </div>
      </div>

      <div>
        <Toggle
          checked={bucketsEnabled}
          onChange={onBucketsEnabledChange}
          label="Use performance buckets"
          size="sm"
          labelPosition="right"
          className="text-sm"
        />
        <p className="muted text-xs leading-snug mt-1">
          Spread each bucket evenly across tables (e.g. top third, middle third, bottom third). Any positive integers; uneven groups are fine.
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
                  onChange={n => onBucketChange(p.player_id, n)}
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
        <SeatDrawReveal tables={sortedTables} seatsPerTable={seatsPerTable} drawSeq={drawSeq} />
      )}
    </div>
  );
}
