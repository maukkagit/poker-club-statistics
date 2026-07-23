"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StructureRow, TournamentClock as ClockState } from "@/lib/types";
import { deriveClockView, formatClock, type ClockAggregates } from "@/lib/tournament-clock";
import { useClockTicker } from "@/components/useClockTicker";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { eur, ordinal } from "@/lib/format";

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** Art-skin header title: fraction of the stage/header width for FitTitle. */
const ART_TITLE_SCALE = { max: 0.042, min: 0.018 };

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
  /** Show the Add-ons stat (total add-ons purchased). Hidden when falsy. */
  addonsAllowed?: boolean;
  /** Tighter paddings/sizes for embedding in the director console. */
  compact?: boolean;
  /** PKO bounty strip (leader + total cash paid). Hidden when null/undefined. */
  bounty?: {
    leader: { name: string; koCount: number; cashWon: number } | null;
    totalCashPaid: number;
    /** Bounty money still in play: total starting bounties minus cash paid out
     * so far (i.e. the sum of every live bounty currently on a player's head). */
    inPlay: number;
  } | null;
  /**
   * Override the displayed prize pool (e.g. PKO shows the full pool incl.
   * bounty money). Falls back to `aggregates.prizePool` when null/undefined.
   */
  prizePoolDisplay?: number | null;
  /** Heading for the payouts list (e.g. "Payouts (excl. bounties)" for PKO). */
  payoutsLabel?: string;
  /** Suppress the internal "Tournament clock" heading (e.g. when the embedder
   * already renders its own section title). */
  hideHeading?: boolean;
  /** Fill the available viewport: the board scales (up or down) to use the full
   * width AND height of its container instead of only matching the width. Used
   * by the full-screen viewer so the clock fills the whole screen. */
  fillViewport?: boolean;
  /** Hide the live clock status label ("Not started"/"Running"/"Paused") in the
   * header. Only the terminal "Finished" state still shows. */
  hideLiveStatus?: boolean;
  /** Hide the logo + tournament name header bar entirely (e.g. in the director
   * console where a separate section heading already identifies the clock). */
  hideTopBar?: boolean;
  /** Fill the tournament title with the animated green gradient (clock viewer). */
  animatedTitle?: boolean;
  /**
   * Visual skin. Art skins lay the scoreboard onto the cream/parchment panels
   * of a themed background image (clock viewer only).
   */
  skin?: "default" | "saloon" | "summer";
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
  const { title, subtitle, structure, clock, aggregates, payouts, addonsAllowed, compact, bounty, prizePoolDisplay, payoutsLabel, hideHeading, fillViewport, hideLiveStatus, hideTopBar, animatedTitle, skin = "default" } = props;
  const art: "saloon" | "summer" | null =
    (skin === "saloon" || skin === "summer") && !compact ? skin : null;
  const ornament = art === "summer" ? "✿" : "★";
  const flourish = art === "summer" ? "～" : "⁓";
  const prizePool = prizePoolDisplay ?? aggregates.prizePool;
  const running = !!clock?.running && !!clock?.started;
  const now = useClockTicker(running);
  const view = deriveClockView(structure, clock, now);

  // Clock drama (full-screen viewer only — the compact director preview stays
  // calm). Flash the board on a level change so nobody misses it, and make the
  // countdown tense in its final seconds (amber ≤10s, pulsing red ≤5s).
  const [levelFlash, setLevelFlash] = useState(false);
  const prevLevelRef = useRef<number | null>(null);
  useEffect(() => {
    if (!view.started || view.finished) { prevLevelRef.current = view.levelNumber; return; }
    if (prevLevelRef.current != null && prevLevelRef.current !== view.levelNumber) {
      setLevelFlash(true);
      const t = setTimeout(() => setLevelFlash(false), 3000);
      prevLevelRef.current = view.levelNumber;
      return () => clearTimeout(t);
    }
    prevLevelRef.current = view.levelNumber;
  }, [view.levelNumber, view.started, view.finished]);

  const countdownActive = !compact && view.started && !view.finished && !view.isBreak && running;
  const urgent = countdownActive && view.remainingMs <= 10000 && view.remainingMs > 5000;
  const critical = countdownActive && view.remainingMs <= 5000;
  const timeDramaClass = critical ? " clock-critical" : urgent ? " clock-urgent" : "";

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
  // Animated green gradient fill for the prize-pool / payout figures (clock
  // viewer only), matching the tournament title. Art skins use solid ink on
  // the photo panels instead (the art already supplies the boards).
  const grad = animatedTitle && !art ? " title-gradient" : "";

  // Header bars — logo/title/status, the buy-in sub-header and the PKO bounty
  // strip. Rendered at normal (responsive) size OUTSIDE the scaled board so
  // they stay legible regardless of how far the board is scaled down to fit.
  // Hide the live status label (Not started / Running / Paused) when requested;
  // only the terminal "Finished" state still shows.
  const statusLabel = hideLiveStatus && !view.finished ? "" : statusText(view);

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
          headingClassName={animatedTitle ? "title-gradient" : undefined}
          baseRem={compact ? 1 : 1.5}
          smRem={compact ? 1 : 3}
          minRem={compact ? 0.7 : 0.9}
        />
        {/* Mirror the logo's width on the right so the centered title stays
            visually centered in the bar (the status label is usually hidden). */}
        <span
          className={`uppercase tracking-wide font-semibold text-right shrink-0 ${sz("text-xs sm:text-base", "text-[0.65rem]")} ${sz("w-9 sm:w-14", "w-7")}`}
          style={{ color: statusColor(view) }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Sub-header strip */}
      {subtitle && (
        <div className={`card text-center font-semibold py-1.5 sm:py-2 ${sz("text-sm sm:text-2xl", "text-xs")}`}>
          {subtitle}
        </div>
      )}
    </div>
  );

  const leftStatItems = [
    { label: "Players", value: `${aggregates.playersRemaining} / ${aggregates.playersTotal}` as ReactNode },
    { label: "Re-Entries", value: <AnimatedNumber value={aggregates.reEntries} format={num} /> },
    ...(addonsAllowed
      ? [{ label: "Add-ons", value: <AnimatedNumber value={aggregates.addons} format={num} /> as ReactNode }]
      : []),
    { label: "Chips in Play", value: (aggregates.chipsInPlay > 0 ? <AnimatedNumber value={aggregates.chipsInPlay} format={num} /> : "—") as ReactNode },
    { label: "Average Stack", value: (aggregates.averageStack > 0 ? <AnimatedNumber value={aggregates.averageStack} format={num} /> : "—") as ReactNode },
    { label: "Break in", value: (view.isBreak ? "On break" : view.breakInMs == null ? "—" : formatClock(view.breakInMs)) as ReactNode },
  ];

  const leftStats = (
    <div className={`flex flex-col text-center h-full min-h-0 ${art ? "justify-evenly px-[0.2cqw] py-[0.4cqw]" : sz("gap-5", "gap-2")}`}>
      {leftStatItems.map((item, i) => (
        <div key={item.label} className={art ? "min-w-0 shrink" : undefined}>
          {art && i > 0 && <div className={`${art}-rule`} aria-hidden>{ornament}</div>}
          <Stat compact={compact} art={art} label={item.label} value={item.value} />
        </div>
      ))}
    </div>
  );

  const centerBoard = (
    <div className={`overflow-hidden flex flex-col h-full min-h-0${!compact && levelFlash && !art ? " level-pulse" : ""}${art ? "" : " card p-0"}`}>
      <div className={`flex-1 flex flex-col items-center justify-center text-center min-h-0 ${art ? "px-[0.6cqw] py-[0.4cqw] gap-[0.2cqw]" : compact ? "px-3 py-5 sm:py-8" : "px-3 py-8"}`}>
        {art && <div className={`${art}-ornament`} aria-hidden>{ornament}</div>}
        <div className={art ? `${art}-ink ${art}-level-label` : `uppercase tracking-widest muted ${sz("text-2xl mb-2", "text-xs mb-1")}`}>
          {centerLabel}
        </div>
        {art && <div className={`${art}-rule ${art}-rule-wide`} aria-hidden>{ornament}</div>}
        {!view.isBreak && (
          art ? (
            <div className={`${art}-ink ${art}-blinds w-full`}>{blinds}</div>
          ) : (
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
          )
        )}
        {ante && !view.isBreak && (
          <div className={art ? `${art}-muted ${art}-ante` : `font-bold muted ${sz("text-3xl mt-1", "text-xs mt-0.5")}`}>{ante}</div>
        )}
        {art && <div className={`${art}-hairline`} aria-hidden />}
        <div
          className={`font-bold tabular-nums leading-none ${art ? `${art}-timer` : ""} ${timeClass}${timeDramaClass}${art ? "" : ` ${sz("mt-10", "mt-3")}`}`}
          style={
            art
              ? { fontFamily: `var(--font-${art}-stack)` }
              : {
                  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                  fontSize: compact ? "clamp(1.5rem, 6vw, 3rem)" : "5rem",
                }
          }
        >
          {formatClock(view.remainingMs)}
        </div>
      </div>
      <div
        className={`text-center font-bold shrink-0 ${art ? `${art}-next-plaque` : sz("text-3xl py-3", "text-sm py-1.5")}`}
        style={art ? undefined : { background: "var(--bg)" }}
      >
        {nextBlinds ? (
          <>
            <div className={art ? "uppercase tracking-[0.08em]" : undefined}>
              {art && <span className={`${art}-ornament-inline`} aria-hidden>{ornament}{" "}</span>}
              {compact && !art ? (
                <>
                  <span className="sm:hidden">Next:</span>
                  <span className="hidden sm:inline">Next blinds:</span>
                </>
              ) : (
                "Next blinds:"
              )}{" "}
              {nextBlinds}
              {art && <span className={`${art}-ornament-inline`} aria-hidden>{" "}{ornament}</span>}
            </div>
            {nextAnte && (
              <div className={`font-semibold ${art ? `${art}-muted text-[0.85em] uppercase tracking-wide` : `muted ${sz("text-3xl", "text-xs")}`}`}>{nextAnte}</div>
            )}
          </>
        ) : (
          <span className={art ? "uppercase tracking-[0.08em]" : undefined}>{nextFallback}</span>
        )}
      </div>
    </div>
  );

  const rightPrizes = (
    <div className={`flex flex-col text-center min-w-0 h-full ${art ? "justify-evenly overflow-y-auto px-[0.3cqw] py-[0.4cqw]" : ""}`}>
      <div>
        <div className={art ? `${art}-ink ${art}-section-label` : `font-bold ${sz("text-3xl", "text-xs")}`}>
          Prize pool
        </div>
        <div className={`font-bold tabular-nums ${art ? `${art}-money ${art}-prize-value` : sz(bounty ? "text-2xl mb-2" : "text-2xl mb-4", "text-xs mb-2")}${grad}`}>
          <AnimatedNumber value={prizePool} format={eur} />
        </div>
      </div>
      {bounty && (
        <div>
          {art && <div className={`${art}-rule`} aria-hidden>{ornament}</div>}
          <div className={art ? `${art}-ink ${art}-section-label` : `font-bold ${sz("text-3xl", "text-xs")}`}>Bounties in play</div>
          <div className={`tabular-nums ${art ? `${art}-money ${art}-prize-value` : sz("text-2xl mb-4", "text-xs mb-2")}${grad}`}>
            <AnimatedNumber value={bounty.inPlay} format={eur} />
          </div>
        </div>
      )}
      <div>
        {art && <div className={`${art}-rule`} aria-hidden>{ornament}</div>}
        <div className={art ? `${art}-ink ${art}-section-label mb-[0.3cqw]` : `font-bold ${sz("text-3xl mb-2", "text-xs mb-1")}`}>
          {payoutsLabel ?? "Payouts"}
        </div>
        <ul className={`overflow-y-auto leading-snug tabular-nums ${art ? `${art}-payouts ${art}-ink` : sz("text-2xl", "text-xs")}`}>
          {payouts.map(p => (
            <li key={p.position} className="text-center whitespace-nowrap">
              {ordinal(p.position)}: <span className={`font-semibold ${art ? `${art}-money` : ""}${grad}`}><AnimatedNumber value={p.amount} format={eur} /></span>
            </li>
          ))}
          {payouts.length === 0 && <li className="muted text-sm">No payouts configured.</li>}
        </ul>
      </div>
    </div>
  );

  // The scaled board: just the three-column scoreboard. Rendered at a fixed
  // design width and uniformly scaled to fit (full clock only).
  const board = (
    <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,3.2fr)_minmax(0,1fr)] items-start ${compact ? "gap-2" : "gap-4"}`}>
      {leftStats}
      {centerBoard}
      {rightPrizes}
    </div>
  );

  // Art skins: pin text to the three panels of the background art.
  if (art) {
    const stage = (
      <div className={`${art}-stage${fillViewport ? ` ${art}-stage-fill` : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static theme asset; avoid next/image layout fights with absolute panels */}
        <img
          src={`/themes/${art}-bg.jpg`}
          alt=""
          className={`${art}-stage-bg`}
          draggable={false}
        />
        <div className={`${art}-header`}>
          <div className={`${art}-title`}>
            <span className={`${art}-title-star`} aria-hidden>{ornament}</span>
            <FitTitle
              text={title}
              className={`${art}-title-fit min-w-0 flex-1`}
              headingClassName={`${art}-title-heading`}
              baseRem={1.25}
              smRem={2.5}
              minRem={0.75}
              containerScale={ART_TITLE_SCALE}
            />
            <span className={`${art}-title-star`} aria-hidden>{ornament}</span>
          </div>
          {subtitle && (
            <div className={`${art}-subtitle`}>
              <span className={`${art}-flourish`} aria-hidden>{flourish}</span>
              <span>{subtitle}</span>
              <span className={`${art}-flourish`} aria-hidden>{flourish}</span>
            </div>
          )}
        </div>
        <div className={`${art}-panel ${art}-panel-left${addonsAllowed ? ` ${art}-panel-left-tall` : ""}`}>{leftStats}</div>
        <div className={`${art}-panel ${art}-panel-center`}>{centerBoard}</div>
        <div className={`${art}-panel ${art}-panel-right`}>{rightPrizes}</div>
      </div>
    );
    return (
      <div
        className={
          fillViewport
            ? "h-full min-h-0 w-full flex items-center justify-center [container-type:size]"
            : "w-full"
        }
      >
        {stage}
      </div>
    );
  }

  // Full clock: the header stays at normal size; the board is rendered at a
  // fixed design width and scaled to fit so it looks proportionally identical
  // on a phone, a tablet and a projector. The compact director-console preview
  // renders everything inline at its native size.
  // In fill mode the whole component becomes a full-height flex column so the
  // header bars keep their natural size and the board flexes to fill the rest
  // of the viewport (scaled to fit both width and height).
  if (!compact && fillViewport) {
    return (
      <div className="flex flex-col h-full min-h-0 space-y-3">
        {!hideTopBar && topBars}
        {!hideHeading && <h2 className="text-lg font-semibold">Tournament clock</h2>}
        <div className="flex-1 min-h-0">
          <ScaleToFit designWidth={1280} fill>{board}</ScaleToFit>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {!hideTopBar && topBars}
      {/* The clock itself — the header bars above are tournament info, not part
          of the clock, so the heading sits here, directly above the board. */}
      {!compact && !hideHeading && <h2 className="text-lg font-semibold">Tournament clock</h2>}
      {compact ? board : <ScaleToFit designWidth={1280}>{board}</ScaleToFit>}
    </div>
  );
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Renders `children` at a fixed `designWidth` and uniformly scales them with a
 * CSS transform. Every child keeps an identical ratio to every other child on
 * any device.
 *
 * Default (width) mode: scales to fill the available WIDTH (never upscaling past
 * the design size); the wrapper height tracks the scaled content height so it
 * doesn't leave a gap or overlap following content.
 *
 * `fill` mode: scales to fit both the available WIDTH and HEIGHT of the wrapper
 * (which must have a real height, e.g. a flex child), upscaling past the design
 * size when there's room, and centers the result. Used by the full-screen
 * viewer so the clock fills the whole screen.
 */
function ScaleToFit({ designWidth, fill = false, children }: { designWidth: number; fill?: boolean; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useIsoLayoutEffect(() => {
    const measure = () => {
      const availW = wrap.current?.clientWidth ?? designWidth;
      // offsetHeight is the un-transformed (design-space) content height.
      const contentH = content.current?.offsetHeight ?? 0;
      if (fill) {
        const availH = wrap.current?.clientHeight ?? contentH;
        const s = contentH > 0
          ? Math.min(availW / designWidth, availH / contentH)
          : availW / designWidth;
        setScale(s);
        setHeight(undefined); // height comes from the flex parent in fill mode
      } else {
        const s = Math.min(1, availW / designWidth);
        setScale(s);
        setHeight(contentH * s);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [designWidth, fill]);
  if (fill) {
    // Flex-center the (unscaled) design-space box; scaling from its center keeps
    // it visually centered while filling the available space.
    return (
      <div ref={wrap} style={{ height: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          ref={content}
          style={{ width: designWidth, flex: "none", transformOrigin: "center", transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    );
  }
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
 *
 * When `containerScale` is set, sizing is a fraction of the container width
 * instead (used by the saloon stage so titles track the art in both sidebar
 * and fullscreen layouts).
 */
function FitTitle({ text, baseRem, smRem, minRem, className, headingClassName, containerScale }: {
  text: string;
  baseRem: number;
  smRem: number;
  minRem: number;
  className?: string;
  /** Extra classes for the <h1> itself (e.g. the animated gradient fill). */
  headingClassName?: string;
  /** Size as a fraction of the container width (overrides rem start/min). */
  containerScale?: { max: number; min: number };
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = heading.current;
    const container = wrap.current;
    if (!el || !container) return;
    const LINE_HEIGHT = 1.15;
    const fit = () => {
      const width = container.clientWidth;
      if (width <= 0) return;
      const startPx = containerScale
        ? width * containerScale.max
        : (window.matchMedia("(min-width: 640px)").matches ? smRem : baseRem) * 16;
      const minPx = containerScale
        ? width * containerScale.min
        : minRem * 16;
      // Measure the natural (unclamped) height while shrinking.
      el.style.webkitLineClamp = "99";
      el.style.overflow = "visible";
      let size = startPx;
      el.style.fontSize = `${size}px`;
      let guard = 0;
      while (
        size > minPx &&
        el.scrollHeight > Math.ceil(size * LINE_HEIGHT * 2) + 1 &&
        guard < 120
      ) {
        size = Math.max(minPx, size - 1);
        el.style.fontSize = `${size}px`;
        guard++;
      }
      // Re-arm the 2-line hard cap (covers titles too long even at min size).
      el.style.webkitLineClamp = "2";
      el.style.overflow = "hidden";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, baseRem, smRem, minRem, containerScale]);
  return (
    <div ref={wrap} className={className}>
      <h1
        ref={heading}
        className={`font-bold text-center${headingClassName ? ` ${headingClassName}` : ""}`}
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

function Stat({
  label,
  value,
  compact,
  art,
}: {
  label: string;
  value: ReactNode;
  compact?: boolean;
  art?: "saloon" | "summer" | null;
}) {
  if (art) {
    return (
      <div className="leading-tight min-w-0">
        <div className={`${art}-ink ${art}-stat-label`}>{label}</div>
        <div className={`${art}-ink ${art}-stat-value`}>{value}</div>
      </div>
    );
  }
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
