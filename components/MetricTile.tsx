import type React from "react";

// Section accent → matched Tailwind colour utilities. Concentrating the
// mapping here keeps the MetricTile component agnostic of the actual palette
// and lets each caller pick whatever theme it wants per section.
export type Accent = "sky" | "emerald" | "amber";
export const ACCENT_CLASSES: Record<Accent, { ring: string; text: string; bg: string; dot: string }> = {
  sky:     { ring: "ring-sky-400/20",     text: "text-sky-300",     bg: "bg-sky-400/10",     dot: "bg-sky-400" },
  emerald: { ring: "ring-emerald-400/20", text: "text-emerald-300", bg: "bg-emerald-400/10", dot: "bg-emerald-400" },
  amber:   { ring: "ring-amber-400/20",   text: "text-amber-300",   bg: "bg-amber-400/10",   dot: "bg-amber-400" },
};

/**
 * Shared KPI tile used across the app (dashboard "General stats", tournament
 * summary, etc.) so every metric card reads identically: a 2-line uppercase
 * label, a single-line value, an optional 2/3-line sub, and an optional
 * accent-tinted icon badge in the corner — all on the same gradient surface.
 */
export function MetricTile({
  label, value, sub, icon, accent = "sky", showDescription = true,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: Accent;
  /**
   * Whether to render the bottom description band. Dashboard KPIs keep it
   * (it carries the "who / when" context and reserves a fixed slot so a row
   * of tiles stays bottom-aligned). Tiles that have no meaningful sub — e.g.
   * the tournament summary headline numbers — set this `false` to drop the
   * band entirely and show a much larger value instead.
   */
  showDescription?: boolean;
}) {
  // Every tile renders the same three vertical bands at the same fixed
  // heights — label (up to 2 lines), value (1 line), sub (up to 2 lines).
  // This guarantees the label/value/sub baselines line up across the tiles
  // in a row, regardless of how long any individual string happens to be.
  const a = ACCENT_CLASSES[accent];
  return (
    <div
      className={[
        "relative overflow-hidden rounded-xl",
        "border border-white/[0.05]",
        "bg-gradient-to-b from-[#1a224a] to-[#0e1430]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        // Mobile padding is intentionally tight so 11-char labels like
        // "TOURNAMENTS" still fit on one line of the wrapped label.
        "px-2 py-2.5 sm:p-3.5",
        "flex flex-col gap-0.5 sm:gap-1",
        "transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.35)]",
      ].join(" ")}
    >
      {/* Icon badge is desktop-only — on a 3-cols-in-390px mobile grid each
          tile only has ~50px of horizontal room for the label, and an icon
          chip in the corner would force long phrases to clip. */}
      {icon && (
        <div
          aria-hidden="true"
          className={[
            "hidden sm:inline-flex",
            "absolute top-2.5 right-2.5",
            "items-center justify-center",
            "w-7 h-7 rounded-md",
            "ring-1", a.ring, a.bg, a.text,
          ].join(" ")}
        >
          {icon}
        </div>
      )}

      <div
        className="text-[0.7rem] sm:text-xs uppercase tracking-normal sm:tracking-[0.08em] font-semibold leading-tight muted break-words line-clamp-2 min-h-[2.5em] sm:pr-9"
        title={label}
      >
        {label}
      </div>
      <div
        className={[
          "font-bold leading-tight tracking-tight tabular-nums break-words min-h-[1em] text-[var(--text)]",
          // No description band → give the value a lot more presence.
          showDescription ? "text-xl sm:text-[1.7rem]" : "text-3xl sm:text-[2.5rem]",
        ].join(" ")}
      >
        {value}
      </div>
      {showDescription && (
        <div
          className="text-[0.7rem] sm:text-xs leading-tight muted break-words line-clamp-3 sm:line-clamp-2 min-h-[3.75em] sm:min-h-[2.5em]"
          title={sub ?? ""}
          aria-hidden={!sub}
        >
          {sub ?? "\u00A0"}
        </div>
      )}
    </div>
  );
}

// --- Icons -------------------------------------------------------------
// Tiny inline stroke icons sized to the badge slot. They use `currentColor`
// so the accent palette in ACCENT_CLASSES tints them automatically when
// applied as `text-*` on the parent badge.
const SVG_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
export function IconCalendar() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M16 3v3M8 3v3M3 10h18" />
    </svg>
  );
}
export function IconUsers() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
export function IconUsersPlus() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M14 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="7.5" cy="7.5" r="3.5" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}
export function IconWallet() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M19 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2V7Z" />
      <path d="M17 7V5.5A1.5 1.5 0 0 0 15.5 4H6.5A2.5 2.5 0 0 0 4 6.5" />
      <circle cx="17" cy="14" r="1" />
    </svg>
  );
}
export function IconCoin() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9.5c-.5-1-1.7-1.5-3-1.5-1.8 0-3 1-3 2.2 0 1 .6 1.6 2 1.9l2 .4c1.4.3 2 .9 2 1.9 0 1.2-1.2 2.2-3 2.2-1.3 0-2.5-.5-3-1.5M12 6v2M12 16v2" />
    </svg>
  );
}
export function IconTrendingUp() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}
export function IconTrophy() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}
export function IconAward() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" />
    </svg>
  );
}
export function IconTarget() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}
