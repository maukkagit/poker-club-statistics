"use client";
import { useEffect, useRef, useState } from "react";
import type { StructureRow, TournamentClock as ClockState } from "@/lib/types";
import { deriveClockView, formatClock, type ClockAggregates } from "@/lib/tournament-clock";
import { useClockTicker } from "@/components/useClockTicker";
import { eur, ordinal } from "@/lib/format";

const num = (n: number) => n.toLocaleString("en-US");

export type TournamentClockProps = {
  title: string;
  structure: StructureRow[];
  clock: ClockState | null;
  aggregates: ClockAggregates;
  payouts: { position: number; amount: number }[];
  /** Tighter paddings/sizes for embedding in the director console. */
  compact?: boolean;
};

/**
 * Projector-friendly tournament clock. Center: current level / blinds / time
 * remaining / next level. Left: live counts (players, re-entries, chips,
 * average stack, time to break). Right: prize pool + payout distribution.
 *
 * Everything is derived from the immutable `structure` + the single-counter
 * `clock`; the local ticker keeps the countdown smooth without refetching.
 */
export default function TournamentClock(props: TournamentClockProps) {
  const { title, structure, clock, aggregates, payouts, compact } = props;
  const running = !!clock?.running && !!clock?.started;
  const now = useClockTicker(running);
  const view = deriveClockView(structure, clock, now);

  if (!view.configured) {
    return (
      <div className="card text-center py-10">
        <div className="muted">No clock structure was configured for this tournament.</div>
      </div>
    );
  }

  const blinds = view.level
    ? `${num(view.level.sb)} / ${num(view.level.bb)}`
    : "—";
  const ante = view.level && view.level.ante > 0 ? `${num(view.level.ante)} ante` : null;

  const centerLabel = view.finished
    ? "Tournament complete"
    : view.isBreak
      ? "Break"
      : view.started
        ? `Level ${view.levelNumber}`
        : `Level ${view.levelNumber} — not started`;

  const timeClass = view.isBreak ? "pos" : view.finished ? "muted" : "";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className={compact ? "text-lg font-semibold" : "text-2xl font-bold"}>{title}</h1>
        <span className="text-xs uppercase tracking-wide font-semibold" style={{ color: statusColor(view) }}>
          {statusText(view)}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-2 sm:gap-4">
        {/* Left — live counts */}
        <div className="card grid grid-cols-1 gap-y-3 content-start">
          <Stat label="Players left" value={`${aggregates.playersRemaining} / ${aggregates.playersTotal}`} />
          <Stat label="Re-entries" value={num(aggregates.reEntries)} />
          <Stat label="Chips in play" value={aggregates.chipsInPlay > 0 ? num(aggregates.chipsInPlay) : "—"} />
          <Stat label="Average stack" value={aggregates.averageStack > 0 ? num(aggregates.averageStack) : "—"} />
          <Stat
            label="Next break"
            value={view.isBreak ? "On break" : view.breakInMs == null ? "—" : formatClock(view.breakInMs)}
          />
        </div>

        {/* Center — the clock */}
        <div className="card flex flex-col items-center justify-center text-center py-8">
          <div className="text-sm uppercase tracking-widest muted mb-2">{centerLabel}</div>
          {!view.isBreak && (
            <div className={compact ? "text-xl sm:text-3xl font-bold mb-1" : "text-2xl sm:text-5xl font-bold mb-1"}>
              {blinds}
            </div>
          )}
          {ante && !view.isBreak && <div className="muted text-sm sm:text-base mb-2">{ante}</div>}
          <div
            className={`font-mono font-bold tabular-nums leading-none ${timeClass}`}
            style={{
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: compact ? "clamp(1.75rem, 7vw, 4rem)" : "clamp(2.25rem, 9vw, 7rem)",
            }}
          >
            {formatClock(view.remainingMs)}
          </div>
          <div className="muted text-sm mt-4 min-h-[1.25rem]">
            {view.nextLevel
              ? `Next: ${num(view.nextLevel.sb)} / ${num(view.nextLevel.bb)}${view.nextLevel.ante > 0 ? ` (${num(view.nextLevel.ante)} ante)` : ""}`
              : view.finished ? "Final level" : "Last level"}
          </div>
        </div>

        {/* Right — prizes */}
        <div className="card flex flex-col content-start min-w-0">
          <div className="mb-3 min-w-0">
            <div className="text-xs sm:text-sm muted">Prize pool</div>
            <FitText
              text={eur(aggregates.prizePool)}
              maxRem={compact ? 1.5 : 1.875}
              minRem={0.85}
              className="font-bold"
            />
          </div>
          <ScaledPayouts payouts={payouts} baseRem={0.875} minRem={0.55} />
        </div>
      </div>
    </div>
  );
}

/**
 * Single-line text that shrinks its font (between `minRem` and `maxRem`) so it
 * never wraps or overflows its container. Re-measures on container resize, so a
 * large prize-pool figure auto-fits the narrow right column on any screen.
 */
function FitText({ text, maxRem, minRem, className }: {
  text: string;
  maxRem: number;
  minRem: number;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [rem, setRem] = useState(maxRem);
  useEffect(() => {
    const fit = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      i.style.fontSize = `${maxRem}rem`;
      const need = i.scrollWidth;
      const avail = o.clientWidth;
      const next = need > avail && need > 0 ? Math.max(minRem, (maxRem * avail) / need) : maxRem;
      i.style.fontSize = `${next}rem`;
      setRem(next);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  }, [text, maxRem, minRem]);
  return (
    <div ref={outer} className="overflow-hidden">
      <span
        ref={inner}
        className={className}
        style={{ whiteSpace: "nowrap", display: "inline-block", fontSize: `${rem}rem`, lineHeight: 1.15 }}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * Payout list whose font size shrinks uniformly (down to `minRem`) when the
 * widest "position — amount" row would otherwise overflow the column, so large
 * buy-in payouts stay on one line each. Re-measures on container resize.
 */
function ScaledPayouts({ payouts, baseRem, minRem }: {
  payouts: { position: number; amount: number }[];
  baseRem: number;
  minRem: number;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [rem, setRem] = useState(baseRem);
  useEffect(() => {
    const fit = () => {
      const ul = ref.current;
      if (!ul) return;
      ul.style.fontSize = `${baseRem}rem`;
      let ratio = 1;
      ul.querySelectorAll<HTMLElement>("[data-prow]").forEach(li => {
        if (li.scrollWidth > li.clientWidth && li.scrollWidth > 0) {
          ratio = Math.min(ratio, li.clientWidth / li.scrollWidth);
        }
      });
      const next = ratio < 1 ? Math.max(minRem, baseRem * ratio) : baseRem;
      ul.style.fontSize = `${next}rem`;
      setRem(next);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [payouts, baseRem, minRem]);
  return (
    <ul ref={ref} className="space-y-1 overflow-y-auto" style={{ fontSize: `${rem}rem` }}>
      {payouts.map(p => (
        <li
          key={p.position}
          data-prow
          className="flex items-center justify-between gap-2 rounded px-2 sm:px-3 py-1.5 overflow-hidden whitespace-nowrap"
          style={{ background: "var(--bg)" }}
        >
          <span className="muted shrink-0">{ordinal(p.position)}</span>
          <span className="font-semibold shrink-0">{eur(p.amount)}</span>
        </li>
      ))}
      {payouts.length === 0 && <li className="muted text-sm">No payouts configured.</li>}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.65rem] sm:text-xs uppercase tracking-wide muted">{label}</div>
      <div className="text-base sm:text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function statusText(view: ReturnType<typeof deriveClockView>): string {
  if (view.finished) return "Finished";
  if (!view.started) return "Not started";
  return view.running ? "Running" : "Paused";
}

function statusColor(view: ReturnType<typeof deriveClockView>): string {
  if (view.finished) return "var(--muted)";
  if (!view.started) return "var(--muted)";
  return view.running ? "var(--accent)" : "rgb(251 191 36)";
}
