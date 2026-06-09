"use client";
import type { KeyboardEvent } from "react";
import { cn } from "./cn";

/**
 * iOS-style toggle switch.
 *
 *   <Toggle checked={value} onChange={setValue} label="Include special tournaments" />
 *
 * Behaviour:
 *  - Implemented as `role="switch"` with `aria-checked` for screen readers.
 *  - Click anywhere on the track or label flips the value.
 *  - Space / Enter toggle when focused.
 *  - Respects `disabled` and shows a faded state.
 *  - Animates the thumb with a 200ms ease-out transform so it feels
 *    physical rather than instant.
 *
 * Sizes:
 *  - "md" (default) — 44×24 (touch-friendly, matches Apple Settings).
 *  - "sm"           — 34×20 (for dense forms).
 */
type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  /** Visually-hidden alternative when no inline label fits the layout. */
  ariaLabel?: string;
  /** Extra explanatory line below the label. */
  description?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /**
   * Where the label sits relative to the switch. Default "left" matches
   * iOS Settings (label first, switch last). Use "right" for form-field
   * layouts where the switch reads more naturally as the prefix.
   */
  labelPosition?: "left" | "right";
  className?: string;
};

export function Toggle({
  checked, onChange, label, ariaLabel, description, disabled, size = "md", labelPosition = "left", className,
}: ToggleProps) {
  const flip = () => { if (!disabled) onChange(!checked); };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      flip();
    }
  };

  const dims = size === "sm"
    ? { track: "w-[34px] h-[20px]", thumb: "w-[16px] h-[16px]", shift: "translate-x-[14px]" }
    : { track: "w-[44px] h-[24px]", thumb: "w-[20px] h-[20px]", shift: "translate-x-[20px]" };

  // Colours come straight from CSS variables defined in `app/globals.css`
  // so the switch always picks up the current palette without needing a
  // matching Tailwind theme entry.
  const trackStyle = checked
    ? { background: "var(--accent)", borderColor: "transparent" }
    : { background: "color-mix(in srgb, var(--card) 70%, white 8%)", borderColor: "var(--border)" };

  const Switch = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={!label ? ariaLabel : undefined}
      disabled={disabled}
      onClick={flip}
      onKeyDown={onKey}
      style={trackStyle}
      className={cn(
        "relative inline-flex items-center shrink-0",
        "rounded-full border transition-colors duration-200",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_color-mix(in_srgb,var(--accent)_55%,transparent)]",
        dims.track,
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-px top-px rounded-full bg-white",
          "shadow-[0_1px_2px_rgba(0,0,0,0.4)]",
          "transition-transform duration-200 ease-out",
          dims.thumb,
          checked && dims.shift,
        )}
      />
    </button>
  );

  if (!label && !description) return <span className={className}>{Switch}</span>;

  // No hard-coded font-size on the label/description spans — the outer
  // `<label>` (and any `className` the consumer passes on the Toggle
  // itself) governs sizing. Description steps down one tier for visual
  // hierarchy.
  const LabelBlock = (
    <span className="flex flex-col leading-tight">
      {label && <span style={{ color: "var(--text)" }}>{label}</span>}
      {description && <span className="text-[0.85em] mt-0.5" style={{ color: "var(--muted)" }}>{description}</span>}
    </span>
  );

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2.5 select-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      {labelPosition === "left" ? (
        <>{LabelBlock}{Switch}</>
      ) : (
        <>{Switch}{LabelBlock}</>
      )}
    </label>
  );
}
