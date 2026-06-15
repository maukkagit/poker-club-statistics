// Pure clock derivation for the tournament clock. Given the immutable
// `structure` (blind levels + breaks) and the single-counter `clock` state,
// derive everything the UI shows: current level/break, time remaining, next
// level, time to the next break, and the headline aggregates. No React, no IO —
// the same function runs on the server (public API) and in the browser (ticking
// display). Unit-tested in tests/tournament-clock.test.ts.
import type { BlindLevel, StructureRow, TournamentClock } from "@/lib/types";
import { isLevel } from "@/lib/tournament-structure";
import { eur } from "@/lib/format";

const MS_PER_MIN = 60_000;

/**
 * Sub-header line for the clock board: buy-in plus (when re-entries are
 * enabled) whether the re-entry window is currently open. Returns null when
 * there's no buy-in to show.
 */
export function buyInSubtitle(opts: {
  buyInAmount: number | null | undefined;
  rebuysAllowed?: boolean | null;
  rebuyWindowOpen?: boolean | null;
}): string | null {
  if (!opts.buyInAmount || opts.buyInAmount <= 0) return null;
  const buyIn = `Buy-in ${eur(opts.buyInAmount)}`;
  if (!opts.rebuysAllowed) return buyIn;
  return `${buyIn} | Re-entries ${opts.rebuyWindowOpen ? "open" : "closed"}`;
}

/** Total structure duration in ms (sum of every row's duration_min). */
export function structureTotalMs(structure: StructureRow[]): number {
  return structure.reduce((ms, r) => ms + r.duration_min * MS_PER_MIN, 0);
}

/**
 * Live elapsed-across-the-structure in ms as of `nowMs`. When the clock is
 * running we add the wall-clock time since it was last stamped; when paused (or
 * not started) we return the stored counter. Clamped to [0, total].
 */
export function effectiveElapsedMs(
  structure: StructureRow[],
  clock: TournamentClock | null | undefined,
  nowMs: number,
): number {
  if (!clock || !clock.started) return 0;
  let elapsed = clock.elapsed_ms;
  if (clock.running && clock.updated_at) {
    const stamped = Date.parse(clock.updated_at);
    if (Number.isFinite(stamped)) elapsed += Math.max(0, nowMs - stamped);
  }
  const total = structureTotalMs(structure);
  if (elapsed < 0) elapsed = 0;
  if (total > 0 && elapsed > total) elapsed = total;
  return elapsed;
}

export type ClockView = {
  configured: boolean;     // structure has at least one row
  started: boolean;
  running: boolean;
  finished: boolean;       // counter has reached the end of the structure
  isBreak: boolean;        // current row is a break
  rowIndex: number;        // index into structure of the current row
  levelNumber: number | null; // 1-based blind-level number (null on a break)
  level: BlindLevel | null;   // the current blind level (null on a break)
  remainingMs: number;     // time left in the current row
  nextLevel: BlindLevel | null;   // the next blind level after the current row
  breakInMs: number | null;       // time until the next break starts (null if none ahead)
  effectiveElapsedMs: number;
  totalMs: number;
};

/**
 * Derive the full clock view from the structure + counter at time `nowMs`.
 *
 * Before the clock is started we still present the first level as "up next"
 * with its full duration remaining, so the projector shows the opening blinds
 * rather than a blank.
 */
export function deriveClockView(
  structure: StructureRow[],
  clock: TournamentClock | null | undefined,
  nowMs: number,
): ClockView {
  const totalMs = structureTotalMs(structure);
  const configured = structure.length > 0;
  const started = !!clock?.started;
  const running = !!clock?.running;

  // Pre-built helpers: the next blind level at or after a given index.
  const nextLevelFrom = (from: number): BlindLevel | null => {
    for (let i = from; i < structure.length; i++) {
      const r = structure[i];
      if (isLevel(r)) return r;
    }
    return null;
  };

  if (!configured) {
    return {
      configured: false, started, running, finished: false, isBreak: false,
      rowIndex: -1, levelNumber: null, level: null, remainingMs: 0,
      nextLevel: null, breakInMs: null, effectiveElapsedMs: 0, totalMs: 0,
    };
  }

  // Not started yet: show the opening row with its full duration remaining.
  if (!started) {
    const first = structure[0];
    const firstLevel = isLevel(first) ? first : null;
    const breakIdx = structure.findIndex(r => r.kind === "break");
    return {
      configured: true, started: false, running: false, finished: false,
      isBreak: first.kind === "break",
      rowIndex: 0,
      levelNumber: firstLevel ? 1 : null,
      level: firstLevel,
      remainingMs: first.duration_min * MS_PER_MIN,
      nextLevel: nextLevelFrom(1),
      breakInMs: breakIdx === -1 ? null : durationBefore(structure, breakIdx),
      effectiveElapsedMs: 0,
      totalMs,
    };
  }

  const elapsed = effectiveElapsedMs(structure, clock, nowMs);
  const finished = totalMs > 0 && elapsed >= totalMs;

  // Walk the rows accumulating their [start, end) spans to find the current one.
  let acc = 0;
  let rowIndex = structure.length - 1;
  for (let i = 0; i < structure.length; i++) {
    const span = structure[i].duration_min * MS_PER_MIN;
    if (elapsed < acc + span || i === structure.length - 1) {
      rowIndex = i;
      break;
    }
    acc += span;
  }
  // When finished, pin to the final row with zero remaining.
  if (finished) rowIndex = structure.length - 1;

  const current = structure[rowIndex];
  const spanStart = durationBefore(structure, rowIndex);
  const spanMs = current.duration_min * MS_PER_MIN;
  const remainingMs = finished ? 0 : Math.max(0, spanStart + spanMs - elapsed);

  // 1-based level number = count of level rows up to and including this one.
  let levelNumber: number | null = null;
  if (isLevel(current)) {
    levelNumber = 0;
    for (let i = 0; i <= rowIndex; i++) if (isLevel(structure[i])) levelNumber++;
  }

  // The next break ahead (one whose span starts after the current elapsed).
  let breakInMs: number | null = null;
  for (let i = 0; i < structure.length; i++) {
    if (structure[i].kind !== "break") continue;
    const start = durationBefore(structure, i);
    if (start >= elapsed) { breakInMs = start - elapsed; break; }
  }

  return {
    configured: true,
    started: true,
    running,
    finished,
    isBreak: current.kind === "break",
    rowIndex,
    levelNumber,
    level: isLevel(current) ? current : null,
    remainingMs,
    nextLevel: nextLevelFrom(rowIndex + 1),
    breakInMs,
    effectiveElapsedMs: elapsed,
    totalMs,
  };
}

/** Cumulative duration (ms) of all rows before `index` (the row's start time). */
export function rowStartMs(structure: StructureRow[], index: number): number {
  let ms = 0;
  for (let i = 0; i < index && i < structure.length; i++) ms += structure[i].duration_min * MS_PER_MIN;
  return ms;
}

export type ClockAction =
  | { type: "start" }
  | { type: "setRunning"; running: boolean }
  | { type: "adjust"; deltaMs: number }
  | { type: "setElapsed"; elapsedMs: number; running: boolean };

/**
 * Compute the next clock state for an action at time `nowMs`. This mirrors the
 * SQL in 0004_clock.sql exactly so the director's screen can update
 * optimistically (instant feel) and converge with the server on the next
 * refetch. Pure.
 */
export function applyClockAction(
  structure: StructureRow[],
  clock: TournamentClock | null | undefined,
  action: ClockAction,
  nowMs: number,
): TournamentClock {
  const stamp = new Date(nowMs).toISOString();
  if (action.type === "start") {
    return { started: true, running: true, elapsed_ms: 0, updated_at: stamp };
  }
  const total = structureTotalMs(structure);
  if (action.type === "setElapsed") {
    let next = action.elapsedMs;
    if (next < 0) next = 0;
    if (total > 0 && next > total) next = total;
    return { started: true, running: action.running, elapsed_ms: Math.round(next), updated_at: stamp };
  }
  const eff = effectiveElapsedMs(structure, clock, nowMs);
  if (action.type === "setRunning") {
    return { started: true, running: action.running, elapsed_ms: Math.round(eff), updated_at: stamp };
  }
  // adjust
  let next = eff + action.deltaMs;
  if (next < 0) next = 0;
  if (total > 0 && next > total) next = total;
  return {
    started: true,
    running: !!clock?.running,
    elapsed_ms: Math.round(next),
    updated_at: stamp,
  };
}

/** Cumulative duration (ms) of all rows before `index`. */
function durationBefore(structure: StructureRow[], index: number): number {
  let ms = 0;
  for (let i = 0; i < index; i++) ms += structure[i].duration_min * MS_PER_MIN;
  return ms;
}

/** Format a millisecond duration as `M:SS` (or `H:MM:SS` past an hour). */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

export type ClockEntryLike = { buy_ins: number; finish_position: number | null };

export type ClockAggregates = {
  playersRemaining: number;
  playersTotal: number;
  reEntries: number;
  totalBuyIns: number;
  chipsInPlay: number;
  averageStack: number;
  prizePool: number;
};

/**
 * Headline aggregates for the clock display. Re-entries = total buy-ins beyond
 * one per entrant. Chips in play = total buy-ins × starting stack; average
 * stack divides that across the players still in.
 */
export function computeClockAggregates(
  entries: ClockEntryLike[],
  opts: { buyInAmount: number; startingStack: number | null | undefined },
): ClockAggregates {
  const playersTotal = entries.length;
  const playersRemaining = entries.filter(e => e.finish_position == null).length;
  const totalBuyIns = entries.reduce((s, e) => s + (e.buy_ins || 0), 0);
  const reEntries = Math.max(0, totalBuyIns - playersTotal);
  const stack = opts.startingStack && opts.startingStack > 0 ? opts.startingStack : 0;
  const chipsInPlay = totalBuyIns * stack;
  const averageStack = playersRemaining > 0 ? Math.round(chipsInPlay / playersRemaining) : 0;
  const prizePool = totalBuyIns * (opts.buyInAmount || 0);
  return {
    playersRemaining, playersTotal, reEntries, totalBuyIns,
    chipsInPlay, averageStack, prizePool,
  };
}
