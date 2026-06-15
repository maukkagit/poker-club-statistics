"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StructureRow, TournamentClock as ClockState } from "@/lib/types";
import { deriveClockView, formatClock, type ClockAggregates } from "@/lib/tournament-clock";
import { useClockTicker } from "@/components/useClockTicker";
import { eur, ordinal } from "@/lib/format";
import { formatKoCount } from "@/lib/pko";

const num = (n: number) => n.toLocaleString("en-US");

/**
 * Compact chip count for blinds/antes: values in the thousands collapse to a
 * "k" suffix (7000 → "7k", 7500 → "7.5k", 1250 → "1.25k"); smaller values are
 * shown in full. Keeps long blind levels on the board readable.
 */
const chip = (n: number) => {
  if (n < 1000) return num(n);
  const s = (n / 1000).toFixed(2).replace(/\.?0+$/, "");
  return `${s}k`;
};

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
    ? `${chip(view.level.sb)} / ${chip(view.level.bb)}`
    : "—";
  const ante = view.level && view.level.ante > 0 ? `Ante ${chip(view.level.ante)}` : null;

  const centerLabel = view.finished
    ? "Tournament complete"
    : view.isBreak
      ? "Break"
      : view.started
        ? `Level ${view.levelNumber}`
        : `Level ${view.levelNumber} — not started`;

  const nextBlinds = view.nextLevel ? `${chip(view.nextLevel.sb)} / ${chip(view.nextLevel.bb)}` : null;
  const nextAnte = view.nextLevel && view.nextLevel.ante > 0 ? `Ante ${chip(view.nextLevel.ante)}` : null;
  const nextFallback = view.finished ? "Final level" : "Last level";

  const timeClass = view.isBreak ? "pos" : view.finished ? "muted" : "";
  // For the full (non-compact) clock the whole board is rendered at a fixed
  // design width and uniformly scaled to fit (see ScaleToFit), so every element
  // keeps identical proportions on any device. `sz` therefore returns FIXED
  // (non-responsive) sizes for the full clock; the compact director-console
  // preview keeps its own responsive sizes.
  const sz = (fixed: string, comp: string) => (compact ? comp : fixed);

  // Header bars — logo/title/status, the buy-in sub-header and the PKO bounty
  // strip. Rendered at normal (responsive) size OUTSIDE the scaled board so
  // they stay legible regardless of how far the board is scaled down to fit.
  const topBars = (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {/* Header bar — logo · centered title · live status */}
      <div className={`card flex items-center gap-3 ${compact ? "py-2" : "py-2 sm:py-3"}`}>
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
    </div>
  );

  // The scaled board: just the three-column scoreboard. Rendered at a fixed
  // design width and uniformly scaled to fit (full clock only).
  const board = (
    <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,3.2fr)_minmax(0,1fr)] items-start ${compact ? "gap-2" : "gap-4"}`}>
        {/* Left — live counts */}
        <div className={`flex flex-col text-center ${sz("gap-5", "gap-2")}`}>
          <Stat compact={compact} label="Players" value={`${aggregates.playersRemaining} / ${aggregates.playersTotal}`} />
          <Stat compact={compact} label="Re-Entries" value={num(aggregates.reEntries)} />
          <Stat compact={compact} label="Chips in Play" value={aggregates.chipsInPlay > 0 ? num(aggregates.chipsInPlay) : "—"} />
          <Stat compact={compact} label="Average Stack" value={aggregates.averageStack > 0 ? num(aggregates.averageStack) : "—"} />
          <Stat compact={compact} label="Break in" value={view.isBreak ? "On break" : view.breakInMs == null ? "—" : formatClock(view.breakInMs)} />
        </div>

        {/* Center — the board */}
        <div className="card p-0 overflow-hidden flex flex-col">
          <div className={`flex-1 flex flex-col items-center justify-center text-center px-3 ${compact ? "py-5 sm:py-8" : "py-8"}`}>
            <div className={`uppercase tracking-widest muted ${sz("text-2xl mb-2", "text-xs mb-1")}`}>
              {centerLabel}
            </div>
            {!view.isBreak && (
              // FitText keeps the blinds on a single line, shrinking only if a
              // very long level would overflow the board. In the full clock it
              // measures a fixed design-width board, so the result is identical
              // on every device. w-full so it measures the board, not content.
              <div className="w-full">
                <FitText
                  text={blinds}
                  maxRem={compact ? 2.25 : 5.5}
                  maxRemMobile={compact ? 1.5 : 2.25}
                  minRem={compact ? 1 : 1.5}
                  className="font-bold"
                  fixed={!compact}
                  wrap
                />
              </div>
            )}
            {ante && !view.isBreak && (
              <div className={`muted font-bold ${sz("text-3xl mt-1", "text-xs mt-0.5")}`}>{ante}</div>
            )}
            <div
              className={`font-mono font-bold tabular-nums leading-none ${timeClass} ${sz("mt-10", "mt-3")}`}
              style={{
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                fontSize: compact ? "clamp(1.5rem, 6vw, 3rem)" : "5rem",
              }}
            >
              {formatClock(view.remainingMs)}
            </div>
          </div>
          <div
            className={`text-center font-bold ${sz("text-3xl py-3", "text-sm py-1.5")}`}
            style={{ background: "var(--bg)" }}
          >
            {nextBlinds ? (
              <>
                <div>
                  {compact ? (
                    <>
                      <span className="sm:hidden">Next:</span>
                      <span className="hidden sm:inline">Next blinds:</span>
                    </>
                  ) : (
                    "Next blinds:"
                  )}{" "}{nextBlinds}
                </div>
                {nextAnte && (
                  <div className={`muted font-semibold ${sz("text-3xl", "text-xs")}`}>{nextAnte}</div>
                )}
              </>
            ) : nextFallback}
          </div>
        </div>

        {/* Right — prizes */}
        <div className="flex flex-col text-center min-w-0">
          <div className={`font-bold ${sz("text-3xl", "text-xs")}`}>Pricepool</div>
          <div className={`tabular-nums ${sz("text-2xl mb-4", "text-xs mb-2")}`}>{eur(prizePool)}</div>
          <div className={`font-bold ${sz("text-3xl mb-2", "text-xs mb-1")}`}>{payoutsLabel ?? "Payouts"}</div>
          <ul className={`overflow-y-auto leading-tight tabular-nums ${sz("text-2xl", "text-xs")}`}>
            {payouts.map(p => (
              <li key={p.position} className="text-center whitespace-nowrap">
                {ordinal(p.position)}: <span className="font-semibold">{eur(p.amount)}</span>
              </li>
            ))}
            {payouts.length === 0 && <li className="muted text-sm">No payouts configured.</li>}
          </ul>
        </div>
      </div>
  );

  // Full clock: the header stays at normal size; the board is rendered at a
  // fixed design width and scaled to fit so it looks proportionally identical
  // on a phone, a tablet and a projector. The compact director-console preview
  // renders everything inline at its native size.
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {topBars}
      {/* The clock itself — the header bars above are tournament info, not part
          of the clock, so the heading sits here, directly above the board. */}
      {!compact && <h2 className="text-lg font-semibold">Tournament clock</h2>}
      {compact ? board : <ScaleToFit designWidth={1280}>{board}</ScaleToFit>}
    </div>
  );
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Renders `children` at a fixed `designWidth` and uniformly scales them with a
 * CSS transform so they exactly fill the available width (never upscaling past
 * the design size). Every child keeps an identical ratio to every other child
 * on any device. The wrapper height tracks the scaled content height so it
 * doesn't leave a gap or overlap following content.
 */
function ScaleToFit({ designWidth, children }: { designWidth: number; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useIsoLayoutEffect(() => {
    const measure = () => {
      const avail = wrap.current?.clientWidth ?? designWidth;
      const s = Math.min(1, avail / designWidth);
      setScale(s);
      // offsetHeight is the un-transformed (design-space) height; scale it.
      setHeight((content.current?.offsetHeight ?? 0) * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [designWidth]);
  return (
    <div ref={wrap} style={{ height, overflow: "hidden" }}>
      <div
        ref={content}
        style={{ width: designWidth, transformOrigin: "top left", transform: `scale(${scale})` }}
      >
        {children}
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
 * Text that shrinks its font (between `minRem` and `maxRem`) to fit its
 * container width, re-measuring on container resize. By default it stays on one
 * line (shrinking/clipping). With `wrap`, once the one-line fit would fall below
 * `minRem` — i.e. it'd be too small to read — it instead pins to `minRem` and
 * wraps onto multiple lines, so the blinds stay legible on narrow screens.
 */
function FitText({ text, maxRem, maxRemMobile, minRem, className, wrap = false, fixed = false }: {
  text: string;
  maxRem: number;
  /** Smaller cap below the `sm` breakpoint; defaults to `maxRem`. */
  maxRemMobile?: number;
  minRem: number;
  className?: string;
  wrap?: boolean;
  /** When set, always use `maxRem` (ignore the viewport breakpoint) — for use
   * inside a fixed-width, scaled container where the real viewport is irrelevant. */
  fixed?: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [rem, setRem] = useState(maxRem);
  const [wrapping, setWrapping] = useState(false);
  useEffect(() => {
    const fit = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      // Device-appropriate starting size: a phone shouldn't start from the
      // projector-sized cap (that fills the narrow column with huge digits).
      const wide = fixed || window.matchMedia("(min-width: 640px)").matches;
      const cap = wide ? maxRem : (maxRemMobile ?? maxRem);
      // Measure the natural single-line width at that cap.
      i.style.display = "inline-block";
      i.style.whiteSpace = "nowrap";
      i.style.fontSize = `${cap}rem`;
      const need = i.scrollWidth;
      // Leave slack so sub-pixel rounding never clips under overflow-hidden.
      const avail = o.clientWidth * 0.96;
      const oneLine = need > avail && need > 0 ? (cap * avail) / need : cap;
      if (wrap && oneLine < minRem) {
        // Too small to read on one line — hold the readable floor and wrap.
        setWrapping(true);
        setRem(minRem);
      } else {
        setWrapping(false);
        setRem(Math.max(minRem, Math.min(cap, oneLine)));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    // The first measure can run against a narrower fallback font; once the real
    // (bold) web font loads the text gets wider and would clip, so re-fit then.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [text, maxRem, maxRemMobile, minRem, wrap, fixed]);
  return (
    <div ref={outer} className="overflow-hidden">
      <span
        ref={inner}
        className={className}
        style={{
          whiteSpace: wrapping ? "normal" : "nowrap",
          display: wrapping ? "block" : "inline-block",
          fontSize: `${rem}rem`,
          lineHeight: 1.15,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function Stat({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div>
      <div className={`font-bold ${compact ? "text-xs" : "text-3xl"}`}>{label}</div>
      <div className={`tabular-nums ${compact ? "text-xs" : "text-2xl"}`}>{value}</div>
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
