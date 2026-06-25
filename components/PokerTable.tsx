"use client";
import { seatPositions, MAX_SEATS_PER_TABLE } from "@/lib/seating";

export type TableOccupant = {
  player_id: string;
  name: string;
  seat_no: number;
};

/**
 * Top-down oval poker table for 2–10 seats. Scales fluidly via a viewBox so it
 * works on mobile (tables stack vertically in the parent).
 *
 * When `seats` is given (the table format, e.g. 6/9/10-max) every seat is drawn
 * — occupied seats show the player, the rest show as open chairs. Open seats
 * are the slots a rebalanced player can move into.
 */
export default function PokerTable({
  tableNo, occupants, seats,
}: {
  tableNo: number;
  occupants: TableOccupant[];
  // Total seats at the table (the format). Defaults to the occupant count.
  seats?: number | null;
}) {
  // Occupants in seat order; holes (busted/moved seats) are skipped automatically.
  const ring = [...occupants].sort((a, b) => a.seat_no - b.seat_no);
  const n = ring.length;
  const occupantBySeat = new Map(ring.map(o => [o.seat_no, o]));
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
  const CHIP_W = 24;
  const minDist = minPairDist(seatPts);
  const scale = seatPts.length > 1 ? Math.max(0.55, Math.min(1, minDist / (CHIP_W + 1.5))) : 1;

  const header = openSeats > 0
    ? `Table ${tableNo} · ${n}/${seatCount} seats`
    : `Table ${tableNo} · ${n} player${n === 1 ? "" : "s"}`;

  return (
    <div className="w-[96%] mx-auto">
      <div className="text-xs font-semibold muted mb-1">{header}</div>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto" role="img" aria-label={`Table ${tableNo} seating`}>
        {/* Felt */}
        <ellipse cx={cx} cy={cy} rx={34} ry={18}
          fill="rgb(16 122 87 / 0.18)" stroke="rgb(16 122 87 / 0.55)" strokeWidth={0.8} />
        <ellipse cx={cx} cy={cy} rx={FELT_INNER_RX} ry={FELT_INNER_RY}
          fill="none" stroke="rgb(16 122 87 / 0.3)" strokeWidth={0.5} />

        {seatCount === 0 && (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            fontSize={4} fill="var(--muted, #888)">Empty</text>
        )}

        {seatPts.map((p, i) => {
          const seatNo = i + 1;
          const o = occupantBySeat.get(seatNo) ?? null;

          if (!o) {
            // Open chair — eligible target for a rebalance move.
            return (
              <g key={`open-${seatNo}`}>
                <rect
                  x={p.x - 12 * scale} y={p.y - 6.5 * scale} width={24 * scale} height={13 * scale} rx={3 * scale}
                  fill="transparent" stroke="var(--border, #333)" strokeWidth={0.5}
                  strokeDasharray="1.6 1.4"
                />
                <text x={p.x} y={p.y - 0.5 * scale} textAnchor="middle" fontSize={2.8 * scale}
                  fill="var(--muted, #777)">Open</text>
                <text x={p.x} y={p.y + 3.6 * scale} textAnchor="middle" fontSize={2.6 * scale}
                  fill="var(--muted, #777)">Seat {seatNo}</text>
              </g>
            );
          }

          // Wrap the name onto up to two lines and shrink the font when even a
          // wrapped line would overflow the chip, so long names stay readable
          // instead of being clipped with an ellipsis. `scale` shrinks the chip
          // (and its text) further on crowded tables.
          const { lines, fontSize } = layoutName(o.name, scale);
          const twoLines = lines.length === 2;
          const seatY = twoLines ? p.y + 4.4 * scale : p.y + 3.6 * scale;
          return (
            <g key={o.player_id}>
              {/* Seat chip */}
              <rect
                x={p.x - 12 * scale} y={p.y - 6.5 * scale} width={24 * scale} height={13 * scale} rx={3 * scale}
                fill="var(--card, #1b1b1f)"
                stroke="var(--border, #333)"
                strokeWidth={0.6}
              />
              {twoLines ? (
                <text x={p.x} y={p.y - 2.6 * scale} textAnchor="middle" fontSize={fontSize} fontWeight={600}
                  fill="var(--fg, #e6e6e6)">
                  <tspan x={p.x} dy={0}>{lines[0]}</tspan>
                  <tspan x={p.x} dy={fontSize * 1.02}>{lines[1]}</tspan>
                </text>
              ) : (
                <text x={p.x} y={p.y - 1 * scale} textAnchor="middle" fontSize={fontSize} fontWeight={600}
                  fill="var(--fg, #e6e6e6)">{lines[0]}</text>
              )}
              <text x={p.x} y={seatY} textAnchor="middle" fontSize={2.6 * scale}
                fill="var(--muted, #9a9a9a)">Seat {o.seat_no}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Inner felt oval (the lighter decorative ring line).
const FELT_INNER_RX = 30;
const FELT_INNER_RY = 14.5;

// Chip name fitting (all values are viewBox units). A seat chip is 24 wide;
// leave ~1.5 units of padding each side for ~21 usable units. K approximates
// the average glyph advance per font-size unit for the 600-weight UI font.
const CHIP_MAXW = 21;
const NAME_BASE_FS = 3.6;
const NAME_MIN_FS = 2.3;
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
