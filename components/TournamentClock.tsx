"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { StructureRow, TournamentClock as ClockState } from "@/lib/types";
import { deriveClockView, formatClock, type ClockAggregates } from "@/lib/tournament-clock";
import { useClockTicker } from "@/components/useClockTicker";
import { eur, ordinal } from "@/lib/format";
import { formatKoCount } from "@/lib/pko";

const num = (n: number) => n.toLocaleString("en-US");

export type TournamentClockProps = {
  title: string;
  /** Secondary info line shown in the sub-header bar (e.g. buy-in details). */
  subtitle?: string | null;
  structure: StructureRow[];
  clock: ClockState | null;
  aggregates: ClockAggregates;
  payouts: { position: number; amount: number }[];
  /** Tighter paddings/sizes for embedding in the director console. */
  compact?: boolean;
  /** PKO bounty strip (leader + total cash paid). Hidden when null/undefined. */
  bounty?: {
    leader: { name: string; koCount: number; cashWon: number } | null;
    totalCashPaid: number;
  } | null;
  /**
   * Override the displayed prize pool (e.g. PKO shows the full pool incl.
   * bounty money). Falls back to `aggregates.prizePool` when null/undefined.
   */
  prizePoolDisplay?: number | null;
  /** Heading for the payouts list (e.g. "Payouts (excl. bounties)" for PKO). */
  payoutsLabel?: string;
};

/**
 * Projector-friendly tournament clock, laid out as a broadcast scoreboard:
 *   - a header bar (home glyph · centered title · live status)
 *   - an optional sub-header strip (buy-in / re-entry info)
 *   - a three-column body: left live counts · center board (level / blinds /
 *     ante / countdown + a "Next blinds" strip) · right prize pool + payouts.
 *
 * Everything is derived from the immutable `structure` + the single-counter
 * `clock`; the local ticker keeps the countdown smooth without refetching.
 * `compact` scales every size down for embedding in the director console.
 */
export default function TournamentClock(props: TournamentClockProps) {
  const { title, subtitle, structure, clock, aggregates, payouts, compact, bounty, prizePoolDisplay, payoutsLabel } = props;
  const prizePool = prizePoolDisplay ?? aggregates.prizePool;
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
  const ante = view.level && view.level.ante > 0 ? `Ante ${num(view.level.ante)}` : null;

  const centerLabel = view.finished
    ? "Tournament complete"
    : view.isBreak
      ? "Break"
      : view.started
        ? `Level ${view.levelNumber}`
        : `Level ${view.levelNumber} — not started`;

  const nextBlinds = view.nextLevel ? `${num(view.nextLevel.sb)} / ${num(view.nextLevel.bb)}` : null;
  const nextAnte = view.nextLevel && view.nextLevel.ante > 0 ? `Ante ${num(view.nextLevel.ante)}` : null;
  const nextFallback = view.finished ? "Final level" : "Last level";

  const timeClass = view.isBreak ? "pos" : view.finished ? "muted" : "";
  const sz = (projector: string, comp: string) => (compact ? comp : projector);

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* Header bar — logo · centered title · live status */}
      <div className="card flex items-center gap-3 py-2 sm:py-3">
        <Image
          src="/logo.png"
          alt="Poker Club Stats"
          width={64}
          height={64}
          priority
          className={`shrink-0 rounded-md ${sz("w-9 h-9 sm:w-14 sm:h-14", "w-7 h-7")}`}
        />
        <FitTitle
          text={title}
          className="flex-1 min-w-0"
          baseRem={compact ? 1 : 1.5}
          smRem={compact ? 1 : 3}
          minRem={compact ? 0.7 : 0.9}
        />
        <span
          className={`uppercase tracking-wide font-semibold text-right shrink-0 ${sz("text-xs sm:text-base", "text-[0.65rem]")}`}
          style={{ color: statusColor(view), minWidth: compact ? "3.5rem" : "5rem" }}
        >
          {statusText(view)}
        </span>
      </div>

      {/* Sub-header strip */}
      {subtitle && (
        <div className={`card text-center font-semibold py-1.5 sm:py-2 ${sz("text-sm sm:text-2xl", "text-xs")}`}>
          {subtitle}
        </div>
      )}

      {/* PKO bounty strip */}
      {bounty && (
        <div className={`card flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center font-semibold py-1.5 sm:py-2 ${sz("text-sm sm:text-xl", "text-xs")}`}>
          <span>
            <span className="muted font-normal">Bounty leader: </span>
            {bounty.leader
              ? `${bounty.leader.name} — ${formatKoCount(bounty.leader.koCount)} KO${bounty.leader.koCount === 1 ? "" : "s"} · ${eur(bounty.leader.cashWon)}`
              : "—"}
          </span>
          <span>
            <span className="muted font-normal">Bounties paid: </span>
            {eur(bounty.totalCashPaid)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] gap-2 sm:gap-4 items-start">
        {/* Left — live counts */}
        <div className={`flex flex-col text-center ${sz("gap-3 sm:gap-5", "gap-2")}`}>
          <Stat compact={compact} label="Players" value={`${aggregates.playersRemaining} / ${aggregates.playersTotal}`} />
          <Stat compact={compact} label="Re-Entries" value={num(aggregates.reEntries)} />
          <Stat compact={compact} label="Chips in Play" value={aggregates.chipsInPlay > 0 ? num(aggregates.chipsInPlay) : "—"} />
          <Stat compact={compact} label="Average Stack" value={aggregates.averageStack > 0 ? num(aggregates.averageStack) : "—"} />
          <Stat compact={compact} label="Break in" value={view.isBreak ? "On break" : view.breakInMs == null ? "—" : formatClock(view.breakInMs)} />
        </div>

        {/* Center — the board */}
        <div className="card p-0 overflow-hidden flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-5 sm:py-8">
            <div className={`uppercase tracking-widest muted ${sz("text-sm sm:text-2xl mb-2", "text-xs mb-1")}`}>
              {centerLabel}
            </div>
            {!view.isBreak && (
              <div
                className="font-bold leading-none"
                style={{ fontSize: sz("clamp(2rem, 7vw, 5.5rem)", "clamp(1.25rem, 5vw, 2.25rem)") }}
              >
                {blinds}
              </div>
            )}
            {ante && !view.isBreak && (
              <div className={`muted font-bold ${sz("text-base sm:text-2xl mt-1", "text-xs mt-0.5")}`}>{ante}</div>
            )}
            <div
              className={`font-mono font-bold tabular-nums leading-none ${timeClass} ${sz("mt-6 sm:mt-10", "mt-3")}`}
              style={{
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                fontSize: sz("clamp(2rem, 6.5vw, 5rem)", "clamp(1.5rem, 6vw, 3rem)"),
              }}
            >
              {formatClock(view.remainingMs)}
            </div>
          </div>
          <div
            className={`text-center font-bold ${sz("text-base sm:text-3xl py-2 sm:py-3", "text-sm py-1.5")}`}
            style={{ background: "var(--bg)" }}
          >
            {nextBlinds ? (
              <>
                <div>
                  <span className="sm:hidden">Next:</span>
                  <span className="hidden sm:inline">Next blinds:</span>{" "}{nextBlinds}
                </div>
                {nextAnte && (
                  <div className={`muted font-semibold ${sz("text-sm sm:text-xl", "text-xs")}`}>{nextAnte}</div>
                )}
              </>
            ) : nextFallback}
          </div>
        </div>

        {/* Right — prizes */}
        <div className="flex flex-col text-center min-w-0">
          <div className={`font-bold ${sz("text-base sm:text-2xl", "text-xs")}`}>Pricepool</div>
          <FitText
            text={eur(prizePool)}
            maxRem={compact ? 1.1 : 1.875}
            minRem={0.7}
            className={`mx-auto ${sz("mb-3 sm:mb-4", "mb-2")}`}
          />
          <div className={`font-bold ${sz("text-base sm:text-2xl mb-1 sm:mb-2", "text-xs mb-1")}`}>{payoutsLabel ?? "Payouts"}</div>
          <ScaledPayouts payouts={payouts} baseRem={compact ? 0.75 : 1.125} minRem={0.55} />
        </div>
      </div>
    </div>
  );
}

/**
 * Centered title that wraps to a second line when it can't fit on one, and
 * shrinks its font (down to `minRem`) so the text always fits within at most
 * two rows — then hard-clamps at two lines as a safety net. Starts from
 * `smRem` on >=640px viewports and `baseRem` on narrow (mobile) ones, and
 * re-measures on container resize.
 */
function FitTitle({ text, baseRem, smRem, minRem, className }: {
  text: string;
  baseRem: number;
  smRem: number;
  minRem: number;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = heading.current;
    const container = wrap.current;
    if (!el || !container) return;
    const LINE_HEIGHT = 1.15;
    const fit = () => {
      const start = window.matchMedia("(min-width: 640px)").matches ? smRem : baseRem;
      // Measure the natural (unclamped) height while shrinking.
      el.style.webkitLineClamp = "99";
      el.style.overflow = "visible";
      let size = start;
      el.style.fontSize = `${size}rem`;
      let guard = 0;
      while (
        size > minRem &&
        el.scrollHeight > Math.ceil(size * 16 * LINE_HEIGHT * 2) + 1 &&
        guard < 100
      ) {
        size = Math.max(minRem, +(size - 0.0625).toFixed(4));
        el.style.fontSize = `${size}rem`;
        guard++;
      }
      // Re-arm the 2-line hard cap (covers titles too long even at minRem).
      el.style.webkitLineClamp = "2";
      el.style.overflow = "hidden";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, baseRem, smRem, minRem]);
  return (
    <div ref={wrap} className={className}>
      <h1
        ref={heading}
        className="font-bold text-center"
        style={{
          lineHeight: 1.15,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </h1>
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
    <ul ref={ref} className="overflow-y-auto leading-tight" style={{ fontSize: `${rem}rem` }}>
      {payouts.map(p => (
        <li key={p.position} data-prow className="text-center overflow-hidden whitespace-nowrap">
          {ordinal(p.position)}: <span className="font-semibold">{eur(p.amount)}</span>
        </li>
      ))}
      {payouts.length === 0 && <li className="muted text-sm">No payouts configured.</li>}
    </ul>
  );
}

function Stat({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div>
      <div className={`font-bold ${compact ? "text-xs" : "text-base sm:text-2xl"}`}>{label}</div>
      <div className={`tabular-nums ${compact ? "text-xs" : "text-sm sm:text-xl"}`}>{value}</div>
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
