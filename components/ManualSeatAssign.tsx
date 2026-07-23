"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import PokerTable, {
  PLAQUE_CHIP,
  PlayerPlaque,
  plaqueScale,
  type TableOccupant,
} from "@/components/PokerTable";
import type { DrawPlayerInfo, DrawResult } from "@/lib/seat-draw";
import { buildManualDrawResult } from "@/lib/seat-draw";

type SeatKey = `${number}:${number}`;

function seatKey(table: number, seat: number): SeatKey {
  return `${table}:${seat}`;
}

/** PokerTable viewBox aspect (width / height). */
const TABLE_ASPECT = 100 / 66;

/**
 * Manual seat assignment board: drag (or click-select) player plaques from the
 * tray into empty chairs on the real PokerTable illustrations. Completing the
 * roster emits a {@link DrawResult} the parent can confirm via assign_seats.
 */
export default function ManualSeatAssign({
  players,
  tables,
  seatsPerTable,
  onResult,
}: {
  players: DrawPlayerInfo[];
  tables: number;
  seatsPerTable: number;
  onResult: (r: DrawResult | null) => void;
}) {
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const scale = plaqueScale(seatsPerTable);

  // Size tables so the first pair fills the board on desktop (1×2). On mobile
  // use a single full-width column so seats stay tappable. Extra tables scroll.
  const boardRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)"); // Tailwind `sm` boundary
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const cols = isMobile || tables <= 1 ? 1 : 2;
  const viewRows = 1; // always frame one row (1 table on mobile, up to 2 on desktop)
  const plaqueWidthPx = fitSize
    ? fitSize.w * (PLAQUE_CHIP.w / 100) * scale
    : null;
  // Tray chips: slightly under the on-table seat size on desktop; closer to (or
  // a touch over) seat size on mobile so they're easy to tap.
  const trayPlaqueW = plaqueWidthPx != null
    ? plaqueWidthPx * (isMobile ? 1.08 : 0.72)
    : null;

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const gap = 4;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      const availW = Math.max(0, width - gap * Math.max(0, cols - 1));
      const availH = Math.max(0, height - gap * Math.max(0, viewRows - 1));
      const cellW = availW / cols;
      const cellH = availH / viewRows;
      if (cellW < 4 || cellH < 4) return;
      let w = cellW;
      let h = w / TABLE_ASPECT;
      if (h > cellH) {
        h = cellH;
        w = h * TABLE_ASPECT;
      }
      // Round + skip no-ops — ResizeObserver can fire on subpixel noise and
      // otherwise fights the tray reflow when a player is seated.
      const next = { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
      setFitSize(prev =>
        prev && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5
          ? prev
          : next,
      );
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [tables, seatsPerTable, cols]);

  useEffect(() => {
    setPlacement({});
    setSelectedId(null);
    setHighlightKey(null);
    onResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, seatsPerTable, players.map(p => p.player_id).join(",")]);

  const nameById = useMemo(
    () => new Map(players.map(p => [p.player_id, p.name])),
    [players],
  );

  const seatedIds = useMemo(() => new Set(Object.values(placement)), [placement]);
  const unassigned = useMemo(
    () => players
      .filter(p => !seatedIds.has(p.player_id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [players, seatedIds],
  );

  useEffect(() => {
    if (Object.keys(placement).length !== players.length) {
      onResult(null);
      return;
    }
    const assignments = Object.entries(placement).map(([key, player_id]) => {
      const [table_no, seat_no] = key.split(":").map(Number);
      return { player_id, table_no, seat_no };
    });
    onResult(buildManualDrawResult({ players, tables, seatsPerTable, assignments }));
  }, [placement, players, tables, seatsPerTable, onResult]);

  function placePlayer(playerId: string, table: number, seat: number) {
    const key = seatKey(table, seat);
    setPlacement(prev => {
      const next = { ...prev };
      for (const [k, id] of Object.entries(next)) {
        if (id === playerId) delete next[k];
      }
      next[key] = playerId;
      return next;
    });
    setSelectedId(null);
    setHighlightKey(null);
  }

  function clearSeat(table: number, seat: number) {
    const key = seatKey(table, seat);
    setPlacement(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function onSeatClick(table: number, seat: number) {
    const key = seatKey(table, seat);
    const occupant = placement[key];
    if (selectedId) {
      placePlayer(selectedId, table, seat);
      return;
    }
    if (occupant) {
      // Return to the tray without keeping them as the active selection.
      clearSeat(table, seat);
      setSelectedId(null);
    }
  }

  const remaining = unassigned.length;
  const done = remaining === 0 && players.length > 0;

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {/* Tray — height-capped so the first pair of tables keeps the vertical room. */}
      <div
        className="shrink-0 rounded-xl border px-3 pt-2.5 pb-2 flex flex-col min-h-0"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--card) 55%, var(--bg))",
        }}
      >
        <div className="flex items-baseline justify-between gap-2 mb-1.5 shrink-0">
          <p className="text-[0.65rem] uppercase tracking-[0.1em] font-semibold muted">
            Unseated players
          </p>
          <p className={`text-xs tabular-nums ${done ? "pos" : "muted"}`}>
            {done ? "All seated" : `${remaining} left`}
          </p>
        </div>
        {unassigned.length === 0 ? (
          // Keep the same tray footprint as the plaque scroller so seating a
          // player (or finishing the roster) doesn't resize the table board.
          <div className="h-[min(20vh,8.5rem)] flex items-center">
            <p className="text-sm muted">
              {done
                ? "Every player has a seat — confirm when you're happy."
                : "No players to seat."}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 items-start content-start overflow-y-auto overscroll-contain h-[min(20vh,8.5rem)]">
            {unassigned.map(p => (
              <PlayerPlaqueChip
                key={p.player_id}
                name={p.name}
                playerId={p.player_id}
                active={selectedId === p.player_id}
                widthPx={trayPlaqueW}
                onSelect={() => setSelectedId(id => (id === p.player_id ? null : p.player_id))}
                onDragStart={() => setSelectedId(p.player_id)}
              />
            ))}
          </div>
        )}
        <p className="muted text-[0.65rem] leading-snug mt-1.5 shrink-0">
          Drag a plaque onto a seat, or tap a player then tap an open chair.
          Tap a seated player to pick them back up.
        </p>
      </div>

      <div
        ref={boardRef}
        className={[
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          // Centre when the framed row is the whole board; otherwise top-align
          // so further rows scroll into place.
          tables <= cols ? "flex items-center justify-center" : "flex justify-center items-start",
        ].join(" ")}
      >
        <div
          className={fitSize ? "" : "invisible"}
          style={
            fitSize
              ? {
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, ${fitSize.w}px)`,
                  gridAutoRows: `${fitSize.h}px`,
                  gap: 4,
                }
              : undefined
          }
        >
          {Array.from({ length: tables }, (_, i) => i + 1).map(tableNo => {
            const occupants: TableOccupant[] = [];
            for (const [key, pid] of Object.entries(placement)) {
              const [t, s] = key.split(":").map(Number);
              if (t !== tableNo) continue;
              occupants.push({
                player_id: pid,
                name: nameById.get(pid) ?? "?",
                seat_no: s,
              });
            }
            const dragHighlight = highlightKey?.startsWith(`${tableNo}:`)
              ? Number(highlightKey.split(":")[1])
              : null;

            return (
              <div
                key={tableNo}
                className="[&_.poker-table-root]:w-full [&_.poker-table-root]:max-w-none"
                style={
                  fitSize
                    ? {
                        width: fitSize.w,
                        height: fitSize.h,
                        // Odd leftover in the last row: span the full grid and
                        // centre so it doesn't sit alone on the left.
                        ...(tableNo === tables && tables % cols !== 0
                          ? { gridColumn: "1 / -1", justifySelf: "center" }
                          : null),
                      }
                    : undefined
                }
              >
                <PokerTable
                  tableNo={tableNo}
                  occupants={occupants}
                  seats={seatsPerTable}
                  interactive={{
                    highlightSeat: dragHighlight,
                    onSeatClick: seat => onSeatClick(tableNo, seat),
                    onSeatDragStart: (seat, playerId) => {
                      if (!playerId) return;
                      setSelectedId(playerId);
                      clearSeat(tableNo, seat);
                    },
                    onSeatDragOver: seat => {
                      setHighlightKey(seat == null ? null : seatKey(tableNo, seat));
                    },
                    onSeatDrop: (seat, playerId) => placePlayer(playerId, tableNo, seat),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlayerPlaqueChip({
  name, playerId, active, widthPx, onSelect, onDragStart,
}: {
  name: string;
  playerId: string;
  active: boolean;
  widthPx: number | null;
  onSelect: () => void;
  onDragStart: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("text/player-id", playerId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onSelect}
      className={[
        "p-0 bg-transparent border-0 rounded-sm select-none shrink-0",
        "cursor-grab active:cursor-grabbing active:scale-95 transition-transform duration-150",
        active ? "ring-2 ring-accent/70" : "",
        widthPx == null ? "invisible" : "",
      ].join(" ")}
      style={{
        width: widthPx ?? PLAQUE_CHIP.w * 3,
        aspectRatio: `${PLAQUE_CHIP.w} / ${PLAQUE_CHIP.h}`,
      }}
      title={name}
    >
      <PlayerPlaque
        name={name}
        label="Unseated"
        highlighted={active}
        gradId={`tray-plaque-${playerId}`}
        className="block w-full h-auto pointer-events-none"
      />
    </button>
  );
}
