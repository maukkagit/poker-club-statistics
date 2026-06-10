// Shared display formatters. These were previously duplicated inline across
// several pages/components; centralizing them keeps the app's currency /
// ordinal / percentage formatting consistent. Pure, no IO.
import type { PlayerStats } from "@/lib/types";

/** Unsigned euro amount, two decimals: `€12.34`. */
export const eur = (n: number) => `€${n.toFixed(2)}`;

/** Signed euro amount: `+€12.34` for non-negative, `€-12.34` for negative. */
export const eurSigned = (n: number) => `${n >= 0 ? "+" : ""}€${n.toFixed(2)}`;

/** Rounded euro amount with thousands grouping: `€1,235`. */
export const eurRounded = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;

/** A number with exactly one fraction digit, grouped: `33.3`. */
export const oneDecimal = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Compact ordinal suffix for finish positions: `1st`, `2nd`, `11th`, … */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * ROI % for a player. Returns null when total cost is 0 so callers can render
 * "—" instead of dividing by zero (or showing a misleading "0%" for a player
 * who simply hasn't played yet).
 */
export function roiPct(s: PlayerStats): number | null {
  return s.total_cost > 0 ? (s.net_profit / s.total_cost) * 100 : null;
}
