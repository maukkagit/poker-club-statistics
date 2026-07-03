"use client";
import type { CSSProperties } from "react";
import { seatPositions, MAX_SEATS_PER_TABLE } from "@/lib/seating";

export type TableOccupant = {
  player_id: string;
  name: string;
  seat_no: number;
};

// Timing for the table-by-table seat-draw reveal (all values in ms). Kept here
// so the parent's sequencing (which table starts when, and when the whole
// sequence ends) uses the exact same numbers the CSS delays are built from.
export const SEAT_REVEAL = {
  shuffleMs: 1400,  // deck riffle before a table starts dealing (matches .shuffle-deck CSS)
  dealStepMs: 550,  // gap between successive players flying to their seats
  flyMs: 420,       // one plaque's flight (matches the .seat-fly animation)
  tableGapMs: 220,  // breather between finishing one table and starting the next
};

/**
 * Start delays (ms) for each table in the reveal, given each table's occupant
 * count, plus the total sequence duration. Tables run strictly one after
 * another: a table's window is its shuffle + (one flight per player) + a gap.
 */
export function seatRevealPlan(occupantCounts: number[]): { delays: number[]; total: number } {
  const delays: number[] = [];
  let acc = 0;
  for (const n of occupantCounts) {
    delays.push(acc);
    acc += SEAT_REVEAL.shuffleMs + Math.max(1, n) * SEAT_REVEAL.dealStepMs + SEAT_REVEAL.flyMs + SEAT_REVEAL.tableGapMs;
  }
  return { delays, total: acc };
}

/**
 * Top-down oval poker table for 2–10 seats. Scales fluidly via a viewBox so it
 * works on mobile (tables stack vertically in the parent).
 *
 * When `seats` is given (the table format, e.g. 6/9/10-max) every seat is drawn
 * — occupied seats show the player, the rest show as open chairs. Open seats
 * are the slots a rebalanced player can move into.
 */
export default function PokerTable({
  tableNo, occupants, seats, revealActive = false, revealDelayMs = 0,
}: {
  tableNo: number;
  occupants: TableOccupant[];
  // Total seats at the table (the format). Defaults to the occupant count.
  seats?: number | null;
  // When true, plaques fly in from the centre (staggered) and a shuffling
  // deck plays first — the animated seat-draw reveal. `revealDelayMs` offsets
  // this table's turn so tables reveal one after another.
  revealActive?: boolean;
  revealDelayMs?: number;
}) {
  // Occupants in seat order; holes (busted/moved seats) are skipped automatically.
  const ring = [...occupants].sort((a, b) => a.seat_no - b.seat_no);
  const n = ring.length;
  const occupantBySeat = new Map(ring.map(o => [o.seat_no, o]));
  // Deal order (0-based) per seat, so players fly in one at a time.
  const dealOrderBySeat = new Map(ring.map((o, idx) => [o.seat_no, idx]));
  const maxSeatNo = ring.reduce((m, o) => Math.max(m, o.seat_no), 0);
  // Draw the full format (e.g. 9 seats), but never fewer than the highest
  // occupied seat — physical seat numbers are fixed and may have gaps.
  const seatCount = Math.min(MAX_SEATS_PER_TABLE, Math.max(Math.floor(seats ?? 0), maxSeatNo, n));
  const openSeats = Math.max(0, seatCount - n);

  const VBW = 100, VBH = 66;
  const cx = 50, cy = 33;
  const seatPts = seatPositions(seatCount, { cx, cy, rx: 42, ry: 25, squareness: 0.5 });

  // Chips have a fixed footprint, so once many seats crowd the ring (9–10-max)
  // they start to overlap. Measure the closest pair of seat centres and shrink
  // the chip — and everything drawn inside it — proportionally so neighbouring
  // chips never touch. Tables with room stay at full size (scale clamped to 1).
  const minDist = minPairDist(seatPts);
  const scale = seatPts.length > 1 ? Math.max(0.55, Math.min(1, minDist / (CHIP_W + 1.5))) : 1;

  const subtitle = seatCount === 0
    ? "Empty"
    : openSeats > 0
      ? `${n}/${seatCount} seats`
      : `${n} player${n === 1 ? "" : "s"}`;

  return (
    <div className="w-[96%] mx-auto">
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto" role="img" aria-label={`Table ${tableNo} · ${subtitle}`}>
        <defs>
          {/* Bright green felt, brighter toward the centre. */}
          <radialGradient id={`felt-${tableNo}`} cx="50%" cy="44%" r="68%">
            <stop offset="0%" stopColor="#2a8f5d" />
            <stop offset="68%" stopColor="#156e43" />
            <stop offset="100%" stopColor="#0a4d2e" />
          </radialGradient>
          {/* Navy padded rail with lighter highlights along top & bottom edges. */}
          <linearGradient id={`rail-${tableNo}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a3b63" />
            <stop offset="14%" stopColor="#16223f" />
            <stop offset="50%" stopColor="#0c1430" />
            <stop offset="86%" stopColor="#16223f" />
            <stop offset="100%" stopColor="#2a3b63" />
          </linearGradient>
          {/* Glowing gold trim — brightest at top & bottom. */}
          <linearGradient id={`gold-${tableNo}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe6a3" />
            <stop offset="26%" stopColor="#e89b39" />
            <stop offset="50%" stopColor="#a5641b" />
            <stop offset="74%" stopColor="#e89b39" />
            <stop offset="100%" stopColor="#ffe6a3" />
          </linearGradient>
          <filter id={`glow-${tableNo}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Player plaque — a small navy card echoing the rail. */}
          <linearGradient id={`seat-${tableNo}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26365b" />
            <stop offset="55%" stopColor="#151f3b" />
            <stop offset="100%" stopColor="#0d1530" />
          </linearGradient>
        </defs>

        {/* Padded navy rail */}
        <rect x={16} y={15} width={68} height={36} rx={18}
          fill={`url(#rail-${tableNo})`} stroke="#080d1e" strokeWidth={0.5} />
        {/* Glowing gold trim ring */}
        <rect x={18.2} y={17.2} width={63.6} height={31.6} rx={15.8}
          fill={`url(#gold-${tableNo})`} filter={`url(#glow-${tableNo})`} />
        {/* Green felt */}
        <rect x={20} y={19} width={60} height={28} rx={14}
          fill={`url(#felt-${tableNo})`} stroke="rgb(0 0 0 / 0.28)" strokeWidth={0.4} />
        {/* Subtle inner felt line */}
        <rect x={27} y={23} width={46} height={20} rx={10}
          fill="none" stroke="rgb(255 255 255 / 0.10)" strokeWidth={0.4} />

        {/* Centre label — a big, letter-spaced "TABLE N" with the player count
            as a subtitle beneath it, sitting in the middle of the felt. */}
        <text
          x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
          fontSize={5} fontWeight={800} letterSpacing={0.8}
          fill="#d9f5e4"
        >
          TABLE {tableNo}
        </text>
        <text
          x={cx} y={cy + 4.6} textAnchor="middle" dominantBaseline="middle"
          fontSize={2.5} fontWeight={600} letterSpacing={0.35}
          fill="#d9f5e4" fillOpacity={0.7}
        >
          {subtitle}
        </text>

        {/* Shuffling deck at the table centre during this table's reveal turn.
            Base opacity 0 keeps it invisible in a static/exported SVG. */}
        {revealActive && (
          <g className="shuffle-deck" style={{ animationDelay: `${revealDelayMs}ms`, opacity: 0 }}>
            {[0, 1, 2, 3].map(k => (
              <rect
                key={k}
                className="card"
                x={cx - 4.5}
                y={cy - 6}
                width={9}
                height={12}
                rx={1.4}
                fill={`url(#rail-${tableNo})`}
                stroke="rgb(233 155 57 / 0.75)"
                strokeWidth={0.4}
                style={{ animationDelay: `${k * 55}ms` }}
              />
            ))}
          </g>
        )}

        {seatPts.map((p, i) => {
          const seatNo = i + 1;
          const o = occupantBySeat.get(seatNo) ?? null;

          const halfW = (CHIP_W / 2) * scale;
          const halfH = (CHIP_H / 2) * scale;

          if (!o) {
            // Open chair — eligible target for a rebalance move.
            return <OpenChair key={`open-${seatNo}`} p={p} seatNo={seatNo} scale={scale} />;
          }

          // Wrap the name onto up to two lines and shrink the font when even a
          // wrapped line would overflow the chip, so long names stay readable
          // instead of being clipped with an ellipsis. `scale` shrinks the chip
          // (and its text) further on crowded tables.
          const { lines, fontSize } = layoutName(o.name, scale);
          const twoLines = lines.length === 2;
          const seatY = twoLines ? p.y + 4.1 * scale : p.y + 3.2 * scale;
          // During the draw reveal the plaque flies from the table centre to
          // its seat; the per-player delay makes them land one at a time after
          // the shuffle. Outside a reveal it's static.
          const dealOrder = dealOrderBySeat.get(seatNo) ?? 0;
          const flyStyle: CSSProperties | undefined = revealActive
            ? ({
                "--fly-dx": `${(cx - p.x).toFixed(2)}px`,
                "--fly-dy": `${(cy - p.y).toFixed(2)}px`,
                animationDelay: `${revealDelayMs + SEAT_REVEAL.shuffleMs + dealOrder * SEAT_REVEAL.dealStepMs}ms`,
              } as CSSProperties)
            : undefined;
          return (
            // Keyed by seat so moving a player to a new seat remounts the plaque.
            <g key={`${o.player_id}-${o.seat_no}`}>
              {/* During the reveal every seat starts as an empty card; the
                  player's plaque then flies in and lands on top of it. */}
              {revealActive && <OpenChair p={p} seatNo={seatNo} scale={scale} />}
              <g className={revealActive ? "seat-fly" : undefined} style={flyStyle}>
              {/* Player plaque */}
              <rect
                x={p.x - halfW} y={p.y - halfH} width={CHIP_W * scale} height={CHIP_H * scale} rx={CHIP_RX * scale}
                fill={`url(#seat-${tableNo})`}
                stroke="rgb(233 155 57 / 0.5)"
                strokeWidth={0.5}
              />
              {twoLines ? (
                <text x={p.x} y={p.y - 2.4 * scale} textAnchor="middle" fontSize={fontSize} fontWeight={700}
                  fill="#eef3ff">
                  <tspan x={p.x} dy={0}>{lines[0]}</tspan>
                  <tspan x={p.x} dy={fontSize * 1.02}>{lines[1]}</tspan>
                </text>
              ) : (
                <text x={p.x} y={p.y - 0.9 * scale} textAnchor="middle" fontSize={fontSize} fontWeight={700}
                  fill="#eef3ff">{lines[0]}</text>
              )}
              <text x={p.x} y={seatY} textAnchor="middle" fontSize={2.4 * scale}
                fill="rgb(231 183 106 / 0.85)">Seat {o.seat_no}</text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * An empty "Open" seat card. Used both for genuinely open chairs and, during
 * the draw reveal, as the placeholder every seat starts as before its player's
 * plaque flies in and lands on top of it.
 */
function OpenChair({ p, seatNo, scale }: { p: { x: number; y: number }; seatNo: number; scale: number }) {
  const halfW = (CHIP_W / 2) * scale;
  const halfH = (CHIP_H / 2) * scale;
  return (
    <g>
      <rect
        x={p.x - halfW} y={p.y - halfH} width={CHIP_W * scale} height={CHIP_H * scale} rx={CHIP_RX * scale}
        fill="rgb(9 16 33 / 0.4)" stroke="rgb(233 155 57 / 0.35)" strokeWidth={0.45}
        strokeDasharray="1.5 1.3"
      />
      <text x={p.x} y={p.y - 0.6 * scale} textAnchor="middle" fontSize={2.7 * scale} fontWeight={600}
        fill="rgb(233 155 57 / 0.75)">Open</text>
      <text x={p.x} y={p.y + 3.2 * scale} textAnchor="middle" fontSize={2.4 * scale}
        fill="rgb(217 245 228 / 0.45)">Seat {seatNo}</text>
    </g>
  );
}

// Player plaque footprint (viewBox units). Kept compact so seats don't crowd
// the felt; `scale` shrinks them further on 9–10-max tables.
const CHIP_W = 22;
const CHIP_H = 11.5;
const CHIP_RX = 2.4;

// Chip name fitting (all values are viewBox units). Leave ~1.5 units of padding
// each side of the plaque for the usable text width. K approximates the average
// glyph advance per font-size unit for the bold UI font.
const CHIP_MAXW = CHIP_W - 3;
const NAME_BASE_FS = 3.4;
const NAME_MIN_FS = 2.2;
const NAME_K = 0.58;

/**
 * Lay a player name out for a seat chip: one line at the base font when it
 * fits, otherwise wrap to two lines and shrink the font (down to a floor) so
 * the longer line still fits the chip width.
 */
function layoutName(name: string, scale = 1): { lines: string[]; fontSize: number } {
  const maxW = CHIP_MAXW * scale;
  const base = NAME_BASE_FS * scale;
  const min = NAME_MIN_FS * scale;
  const fits = (len: number, fs: number) => len * fs * NAME_K <= maxW;
  if (fits(name.length, base)) return { lines: [name], fontSize: base };

  const lines = splitTwo(name);
  const longest = Math.max(lines[0].length, lines[1].length) || 1;
  const fontSize = Math.max(min, Math.min(base, maxW / (longest * NAME_K)));
  return { lines, fontSize };
}

/** Smallest distance between any two seat centres — used to scale the chips so
 *  crowded tables (9–10 seats) don't render overlapping rectangles. */
function minPairDist(pts: Array<{ x: number; y: number }>): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.hypot(dx, dy);
      if (d < m) m = d;
    }
  }
  return m;
}

/** Split a name into two balanced lines — at the space nearest the middle when
 *  there is one, else a hard mid-string cut for a single long token. */
function splitTwo(name: string): [string, string] {
  const mid = name.length / 2;
  let bestSpace = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== " ") continue;
    if (bestSpace < 0 || Math.abs(i - mid) < Math.abs(bestSpace - mid)) bestSpace = i;
  }
  if (bestSpace > 0) return [name.slice(0, bestSpace).trim(), name.slice(bestSpace + 1).trim()];
  const cut = Math.ceil(mid);
  return [name.slice(0, cut), name.slice(cut)];
}
