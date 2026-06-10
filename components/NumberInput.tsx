"use client";
import { useEffect, useRef, useState } from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode" | "min" | "max"> & {
  value: number | null;
  onChange: (n: number | null) => void;
  allowDecimal?: boolean;
  /**
   * Optional inclusive bounds. When set, the committed value is clamped into
   * [min, max] on blur (typing is left untouched so intermediate values like a
   * lone "1" on the way to "10" aren't fought), so an out-of-range entry can
   * never stick.
   */
  min?: number;
  max?: number;
  /**
   * What to do when the user blurs the input while the field is empty.
   *   - "zero"    (default): commit 0
   *   - "null":   commit null (use for nullable fields like "Finish position")
   *   - "previous": revert to the last committed value
   */
  emptyBlurBehavior?: "zero" | "null" | "previous";
};

/**
 * Number-only input that doesn't suffer from the leading-zero glitch in native
 * `<input type="number">`.
 *
 * The native widget has two issues that bite us:
 *   1. When the input shows "0" and the user types "5", the DOM value becomes
 *      "05". React's `value={5}` re-render is a no-op because Chrome sees the
 *      string "05" and the number 5 as the same numeric value, so the leading
 *      zero stays visible until the user manually deletes it.
 *   2. `type="number"` also brings spinner arrows, locale-aware decimal
 *      separators, and inconsistent paste/scroll behaviour across browsers.
 *
 * We solve both by rendering a `type="text"` input with `inputMode` set to the
 * appropriate numeric keyboard on mobile, and tracking the *displayed string*
 * locally so the canonical "no leading zero" representation is always written
 * back to the DOM after every keystroke.
 */
export default function NumberInput({
  value,
  onChange,
  allowDecimal = false,
  emptyBlurBehavior = "zero",
  min,
  max,
  ...rest
}: Props) {
  const clamp = (n: number): number => {
    let v = n;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };
  // Local display string. We render this verbatim, so what the user sees and
  // what the DOM value attribute holds are always in sync.
  const [str, setStr] = useState<string>(value == null ? "" : String(value));
  // Track whether the input is focused so external value changes (e.g. another
  // field recalculating buy_in_amount × buy_ins) don't yank the cursor or
  // overwrite a half-typed value.
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    const canonical = value == null ? "" : String(value);
    if (canonical !== str) setStr(canonical);
    // We intentionally don't depend on `str` here — we only re-sync from the
    // outside when not focused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={str}
      onFocus={e => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onChange={e => {
        let raw = e.target.value;

        // Allow only digits (and a single decimal point for decimals).
        // Reject the keystroke if it doesn't fit the pattern — much better
        // UX than silently mangling input.
        const pattern = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
        if (!pattern.test(raw)) return;

        // Strip leading zeros from integer-only inputs and from the integer
        // part of decimals: "05" → "5", "007" → "7", "0.5" → "0.5".
        // Keep a bare "0" alone — the user may be about to type a decimal.
        if (/^0\d/.test(raw)) raw = raw.replace(/^0+/, "");

        setStr(raw);

        if (raw === "" || raw === ".") {
          // Don't fire onChange while the input is mid-edit-empty. Parent
          // keeps its previous value. We'll resolve it at blur.
          return;
        }
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
      onBlur={e => {
        focused.current = false;
        if (str === "" || str === ".") {
          if (emptyBlurBehavior === "zero") {
            setStr("0");
            onChange(0);
          } else if (emptyBlurBehavior === "null") {
            setStr("");
            onChange(null);
          } else {
            // Restore to the last committed value.
            setStr(value == null ? "" : String(value));
          }
        } else {
          // Canonicalise ("5.0" → "5") and clamp into [min, max] if set.
          const n = Number(str);
          if (!Number.isNaN(n)) {
            const c = clamp(n);
            setStr(String(c));
            if (c !== value) onChange(c);
          }
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
