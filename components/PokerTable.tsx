"use client";
import { seatPositions, computeBlinds, MAX_SEATS_PER_TABLE } from "@/lib/seating";

export type TableOccupant = {
  player_id: string;
  name: string;
  seat_no: number;
};

/**
 * Top-down oval poker table for 2–10 seats, with a dealer button + SB/BB chips
 * derived from the occupied ring + button seat. Scales fluidly via a viewBox so
 * it works on mobile (tables stack vertically in the parent).
 *
 * When `seats` is given (the table format, e.g. 6/9/10-max) every seat is drawn
 * — occupied seats show the player, the rest show as open chairs. Open seats
 * are the slots a rebalanced player can move into.
 */
export default function PokerTable({
  tableNo, occupants, seats, buttonSeat, highlightPlayerId,
}: {
  tableNo: number;
  occupants: TableOccupant[];
  // Total seats at the table (the format). Defaults to the occupant count.
  seats?: number | null;
  // seat_no carrying the dealer button. Defaults to seat 1 when unknown.
  buttonSeat?: number | null;
  // Optional: tint one seat (e.g. the player about to move during a rebalance).
  highlightPlayerId?: string | null;
}) {
  // Occupants in seat order — the ring is the source of truth for blinds, and
  // skips holes (busted/moved seats) automatically.
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

  // Button = the occupant in `buttonSeat` (fall back to the first occupant).
  let btnIdx = ring.findIndex(o => o.seat_no === buttonSeat);
  if (btnIdx < 0) btnIdx = n > 0 ? 0 : -1;
  const blinds = computeBlinds(ring, btnIdx);

  function roleFor(i: number): "BTN" | "SB" | "BB" | null {
    if (i === blinds.buttonIndex && i === blinds.sbIndex) return "BTN"; // heads-up: button is SB
    if (i === blinds.buttonIndex) return "BTN";
    if (i === blinds.sbIndex) return "SB";
    if (i === blinds.bbIndex) return "BB";
    return null;
  }

  // Roles keyed by physical seat number so holes are skipped cleanly.
  const roleBySeat = new Map<number, "BTN" | "SB" | "BB">();
  ring.forEach((o, k) => { const r = roleFor(k); if (r) roleBySeat.set(o.seat_no, r); });
  const btnSeat = blinds.buttonIndex >= 0 ? (ring[blinds.buttonIndex]?.seat_no ?? -1) : -1;

  const header = openSeats > 0
    ? `Table ${tableNo} · ${n}/${seatCount} seats`
    : `Table ${tableNo} · ${n} player${n === 1 ? "" : "s"}`;

  return (
    <div className="w-full">
      <div className="text-xs font-semibold muted mb-1">{header}</div>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-auto" role="img" aria-label={`Table ${tableNo} seating`}>
        {/* Felt */}
        <ellipse cx={cx} cy={cy} rx={34} ry={18}
          fill="rgb(16 122 87 / 0.18)" stroke="rgb(16 122 87 / 0.55)" strokeWidth={0.8} />
        <ellipse cx={cx} cy={cy} rx={30} ry={14.5}
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
                  x={p.x - 11} y={p.y - 6} width={22} height={12} rx={3}
                  fill="transparent" stroke="var(--border, #333)" strokeWidth={0.5}
                  strokeDasharray="1.6 1.4"
                />
                <text x={p.x} y={p.y - 0.5} textAnchor="middle" fontSize={2.8}
                  fill="var(--muted, #777)">Open</text>
                <text x={p.x} y={p.y + 3.6} textAnchor="middle" fontSize={2.6}
                  fill="var(--muted, #777)">Seat {seatNo}</text>
              </g>
            );
          }

          const role = roleBySeat.get(seatNo) ?? null;
          const isBtn = seatNo === btnSeat;
          const highlighted = highlightPlayerId && o.player_id === highlightPlayerId;
          // Pull the dealer-button disc slightly toward the table center.
          const bx = cx + (p.x - cx) * 0.72;
          const by = cy + (p.y - cy) * 0.72;
          const shortName = o.name.length > 11 ? o.name.slice(0, 10) + "…" : o.name;
          return (
            <g key={o.player_id}>
              {/* Seat chip */}
              <rect
                x={p.x - 11} y={p.y - 6} width={22} height={12} rx={3}
                fill={highlighted ? "rgb(251 191 36 / 0.22)" : "var(--card, #1b1b1f)"}
                stroke={highlighted ? "rgb(251 191 36 / 0.9)" : "var(--border, #333)"}
                strokeWidth={highlighted ? 0.9 : 0.6}
              />
              <text x={p.x} y={p.y - 1} textAnchor="middle" fontSize={3.6} fontWeight={600}
                fill="var(--fg, #e6e6e6)">{shortName}</text>
              <text x={p.x} y={p.y + 3.6} textAnchor="middle" fontSize={2.8}
                fill="var(--muted, #9a9a9a)">Seat {o.seat_no}</text>

              {/* Dealer button */}
              {isBtn && (
                <g>
                  <circle cx={bx} cy={by} r={2.6} fill="#fafafa" stroke="#222" strokeWidth={0.3} />
                  <text x={bx} y={by + 1} textAnchor="middle" fontSize={2.8} fontWeight={700} fill="#111">D</text>
                </g>
              )}
              {/* SB / BB chip badge on the seat */}
              {role && role !== "BTN" && (
                <g>
                  <rect x={p.x + 7} y={p.y - 8.5} width={8} height={4.2} rx={1.4}
                    fill={role === "BB" ? "rgb(14 165 233 / 0.9)" : "rgb(168 85 247 / 0.9)"} />
                  <text x={p.x + 11} y={p.y - 5.5} textAnchor="middle" fontSize={2.6} fontWeight={700} fill="#fff">{role}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
