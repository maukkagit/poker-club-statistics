"use client";
import { useCountUp } from "./useCountUp";

/**
 * Renders a number that rolls toward its target on change. Pass a `format`
 * function to control presentation (currency, thousands separators, rounding).
 * Uses `tabular-nums` so the width doesn't jitter as digits roll.
 *
 *   <AnimatedNumber value={prizePool} format={eur} />
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  durationMs,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const display = useCountUp(value, durationMs);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{format(display)}</span>;
}
