"use client";
import { useEffect, useRef, useState } from "react";
import PokerTable, { type TableOccupant } from "@/components/PokerTable";
import { seatPositions } from "@/lib/seating";
import { useReducedMotion } from "@/components/ui/useReducedMotion";

export type RelocateMove = {
  player_id: string;
  name: string;
  fromTableNo: number;
  fromSeat: number;
  toTableNo: number;
  toSeat: number;
};

type TableGroup = { table_no: number; occupants: TableOccupant[] };

// Plaque geometry in the PokerTable viewBox (must match PokerTable's constants
// so the flying replica lines up exactly with the real seat plaques).
const VBW = 100;
const CHIP_W = 22;
const CHIP_H = 11.5;
const CHIP_RX = 2.4;
const NAME_FS = 3.4; // base name font (viewBox units)
const SEAT_FS = 2.4; // "Seat N" font (viewBox units)

// One plaque's flight, slowed down so the move reads clearly as the card
// travelling from one table to the other.
const FLIGHT_MS = 1050;

/**
 * Animated reveal for relocating players between tables — shared by the
 * rebalance "move a player" flow (one mover) and the "break a table" flow
 * (every player on the broken table). Source tables (the ones players leave)
 * render full; destination tables render with the incoming seats still open.
 *
 * Each mover then flies as a replica of their seat plaque from their exact
 * source seat to their exact destination seat: on lift-off the real plaque
 * disappears from the source, and on landing it appears in the new seat.
 *
 * Reduced motion: the flight is skipped and the final seating shows at once.
 */
export default function TableMoveReveal({
  sourceTables, destTables, moves, seatsPerTable, play = true, onDone,
}: {
  // Source tables with their occupants BEFORE anyone leaves.
  sourceTables: TableGroup[];
  // Destination tables with their FINAL occupants (including the movers).
  destTables: TableGroup[];
  moves: RelocateMove[];
  seatsPerTable: number;
  // When false the tables render in their pre-move state without animating
  // (used as a live preview); flip to true to play the relocation.
  play?: boolean;
  // Fired once every mover has landed (or immediately under reduced motion).
  onDone?: () => void;
}) {
  const reduced = useReducedMotion();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // `left`: movers who have lifted off their source seat.
  // `arrived`: movers who have landed in their destination seat.
  const allMoverIds = () => new Set(moves.map(m => m.player_id));
  const [left, setLeft] = useState<Set<string>>(() => (reduced ? allMoverIds() : new Set()));
  const [arrived, setArrived] = useState<Set<string>>(() => (reduced ? allMoverIds() : new Set()));

  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Which table numbers receive a given mover — used to keep incoming players
  // hidden on the destination table until their chip lands.
  const moverToTable = new Map(moves.map(m => [m.player_id, m.toTableNo]));

  useEffect(() => {
    if (!play) return;
    if (reduced) { onDoneRef.current?.(); return; }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(res => { timers.push(setTimeout(res, ms)); });

    // Geometry of a rendered table card: the SVG's on-screen box plus the seat
    // centre coordinates and plaque scale, all matching PokerTable's own maths.
    const geomFor = (card: HTMLDivElement, occupants: TableOccupant[]) => {
      const svg = card.querySelector("svg");
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      const maxSeatNo = occupants.reduce((m, o) => Math.max(m, o.seat_no), 0);
      const seatCount = Math.min(10, Math.max(Math.floor(seatsPerTable), maxSeatNo, occupants.length));
      const pts = seatPositions(seatCount, { cx: 50, cy: 33, rx: 42, ry: 25, squareness: 0.5 });
      const scale = pts.length > 1 ? Math.max(0.55, Math.min(1, minPairDist(pts) / (CHIP_W + 1.5))) : 1;
      const unit = r.width / VBW; // px per viewBox unit (svg preserves the 100×66 ratio)
      return { r, pts, scale, unit };
    };
    const seatScreen = (g: { r: DOMRect; pts: { x: number; y: number }[]; unit: number }, seatNo: number) => {
      const p = g.pts[seatNo - 1] ?? { x: 50, y: 33 };
      return { x: g.r.left + p.x * g.unit, y: g.r.top + p.y * g.unit };
    };

    const settle = (playerId: string, resolve: () => void) => {
      setLeft(prev => new Set(prev).add(playerId));
      setArrived(prev => new Set(prev).add(playerId));
      resolve();
    };

    const flyChip = (move: RelocateMove) => new Promise<void>(resolve => {
      const layer = layerRef.current;
      const fromCard = cardRefs.current.get(move.fromTableNo);
      const toCard = cardRefs.current.get(move.toTableNo);
      const srcGroup = sourceTables.find(g => g.table_no === move.fromTableNo);
      const dstGroup = destTables.find(g => g.table_no === move.toTableNo);
      if (!layer || !fromCard || !toCard || !srcGroup || !dstGroup) { settle(move.player_id, resolve); return; }

      const gFrom = geomFor(fromCard, srcGroup.occupants);
      const gTo = geomFor(toCard, dstGroup.occupants);
      if (!gFrom || !gTo) { settle(move.player_id, resolve); return; }

      const start = seatScreen(gFrom, move.fromSeat);
      const end = seatScreen(gTo, move.toSeat);
      const unit = gFrom.unit * gFrom.scale;

      // A replica of the seat plaque, sized in the source table's units.
      const card = document.createElement("div");
      card.className = "relocate-card";
      card.style.width = `${CHIP_W * unit}px`;
      card.style.height = `${CHIP_H * unit}px`;
      card.style.borderRadius = `${CHIP_RX * unit}px`;
      card.style.left = `${start.x}px`;
      card.style.top = `${start.y}px`;
      card.style.transform = "translate(-50%, -50%) scale(1)";

      const nameEl = document.createElement("div");
      nameEl.className = "relocate-card-name";
      nameEl.textContent = move.name;
      nameEl.style.fontSize = `${NAME_FS * unit}px`;
      const seatEl = document.createElement("div");
      seatEl.className = "relocate-card-seat";
      seatEl.textContent = `Seat ${move.toSeat}`;
      seatEl.style.fontSize = `${SEAT_FS * unit}px`;
      card.append(nameEl, seatEl);
      layer.appendChild(card);

      // Lift-off: the mover leaves their source seat as the replica appears.
      setLeft(prev => new Set(prev).add(move.player_id));

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        card.removeEventListener("transitionend", onEnd);
        card.remove();
        setArrived(prev => new Set(prev).add(move.player_id));
        resolve();
      };
      const onEnd = (e: TransitionEvent) => { if (e.propertyName === "top") finish(); };
      card.addEventListener("transitionend", onEnd);

      requestAnimationFrame(() => {
        card.style.transition =
          `left ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        card.style.left = `${end.x}px`;
        card.style.top = `${end.y}px`;
        // A gentle lift mid-flight sells the "picked up and placed" feel.
        card.style.transform = "translate(-50%, -50%) scale(1.06)";
      });
      timers.push(setTimeout(finish, FLIGHT_MS + 250)); // fallback if transitionend is missed
    });

    (async () => {
      await wait(360); // a short beat before the first mover flies
      for (const m of moves) {
        if (cancelled) return;
        await flyChip(m);
        if (cancelled) return;
        await wait(240);
      }
      if (!cancelled) onDoneRef.current?.();
    })();

    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // moves is a stable prop for the life of the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, play]);

  // Every table shown, sorted so numbering reads left-to-right, top-to-bottom.
  const allTables: (TableGroup & { role: "source" | "dest" })[] = [
    ...sourceTables.map(g => ({ ...g, role: "source" as const })),
    ...destTables.map(g => ({ ...g, role: "dest" as const })),
  ].sort((a, b) => a.table_no - b.table_no);

  const visibleOccupants = (g: TableGroup & { role: "source" | "dest" }): TableOccupant[] => {
    if (g.role === "source") {
      // Drop movers who have already lifted off.
      return g.occupants.filter(o => !left.has(o.player_id));
    }
    // Destination: hide incoming movers until they land.
    return g.occupants.filter(o => moverToTable.get(o.player_id) !== g.table_no || arrived.has(o.player_id));
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {allTables.map((g, i, arr) => {
          const centerLast = arr.length % 2 === 1 && i === arr.length - 1;
          return (
            <div
              key={g.table_no}
              ref={el => { if (el) cardRefs.current.set(g.table_no, el); else cardRefs.current.delete(g.table_no); }}
              className={`card${centerLast ? " col-span-2 w-1/2 justify-self-center" : ""}`}
            >
              <PokerTable tableNo={g.table_no} occupants={visibleOccupants(g)} seats={seatsPerTable} />
            </div>
          );
        })}
      </div>
      {/* Fixed layer the flying plaques are appended to (above the table grid). */}
      <div ref={layerRef} className="fixed inset-0 z-[120] pointer-events-none" aria-hidden="true" />
    </>
  );
}

/** Smallest distance between any two seat centres — mirrors PokerTable so the
 *  replica plaque uses the same crowding scale as the rendered seats. */
function minPairDist(pts: Array<{ x: number; y: number }>): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < m) m = d;
    }
  }
  return m;
}
