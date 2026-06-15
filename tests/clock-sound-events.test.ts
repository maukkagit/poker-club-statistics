import { describe, it, expect } from "vitest";
import {
  detectClockSoundEvents,
  type ClockSoundSnapshot,
} from "@/lib/clock-sound-events";

function snap(over: Partial<ClockSoundSnapshot> = {}): ClockSoundSnapshot {
  return {
    started: true,
    running: true,
    finished: false,
    isBreak: false,
    rowIndex: 0,
    remainingMs: 10 * 60_000,
    elapsedMs: 0,
    atMs: 0,
    bustouts: 0,
    ...over,
  };
}

/**
 * Build the "next" snapshot from `prev` for a NATURAL tick: advance both the
 * wall clock and the elapsed counter by the same `dtMs` (so the detector sees
 * real time passing), then apply the row/remaining overrides.
 */
function naturalTick(prev: ClockSoundSnapshot, over: Partial<ClockSoundSnapshot> = {}, dtMs = 250): ClockSoundSnapshot {
  return { ...prev, atMs: prev.atMs + dtMs, elapsedMs: prev.elapsedMs + dtMs, ...over };
}

/**
 * Build the "next" snapshot for a MANUAL move: the elapsed counter jumps by
 * `elapsedJumpMs` while almost no wall-clock time passes (a director action).
 */
function manualMove(prev: ClockSoundSnapshot, elapsedJumpMs: number, over: Partial<ClockSoundSnapshot> = {}): ClockSoundSnapshot {
  return { ...prev, atMs: prev.atMs + 80, elapsedMs: prev.elapsedMs + elapsedJumpMs, ...over };
}

describe("detectClockSoundEvents", () => {
  it("fires nothing without a previous snapshot (baseline on enable)", () => {
    expect(detectClockSoundEvents(null, snap())).toEqual([]);
  });

  it("plays the level-up jingle when a level naturally rolls into the next", () => {
    const prev = snap({ rowIndex: 0, remainingMs: 200 });
    const next = naturalTick(prev, { rowIndex: 1, remainingMs: 10 * 60_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["levelStart"]);
  });

  it("does NOT play on a manual next-level jump", () => {
    const prev = snap({ rowIndex: 0, remainingMs: 5 * 60_000 });
    const next = manualMove(prev, 5 * 60_000, { rowIndex: 1, remainingMs: 10 * 60_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("does NOT play when the clock is first (manually) started into level 1", () => {
    const prev = snap({ started: false, running: false });
    const next = snap({ started: true, running: true, rowIndex: 0 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("does NOT play level-up when resuming from a pause", () => {
    const prev = snap({ rowIndex: 1, remainingMs: 200, running: false });
    const next = snap({ rowIndex: 2, remainingMs: 10 * 60_000, running: true, atMs: 80, elapsedMs: 0 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("buzzes when the countdown naturally reaches a break", () => {
    const prev = snap({ rowIndex: 1, isBreak: false, remainingMs: 150 });
    const next = naturalTick(prev, { rowIndex: 2, isBreak: true, remainingMs: 10 * 60_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["breakStart"]);
  });

  it("does NOT buzz on a manual jump to a break", () => {
    const prev = snap({ rowIndex: 1, isBreak: false, remainingMs: 4 * 60_000 });
    const next = manualMove(prev, 4 * 60_000, { rowIndex: 2, isBreak: true, remainingMs: 10 * 60_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("stays silent when a break ends and the next level resumes", () => {
    const prev = snap({ rowIndex: 2, isBreak: true, remainingMs: 200 });
    const next = naturalTick(prev, { rowIndex: 3, isBreak: false, remainingMs: 10 * 60_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("ignores backward seeks (director rewind)", () => {
    const prev = snap({ rowIndex: 3, remainingMs: 200 });
    const next = manualMove(prev, -3 * 60_000, { rowIndex: 1 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("chimes once as the running level naturally crosses the final minute", () => {
    const prev = snap({ remainingMs: 60_200 });
    const next = naturalTick(prev, { remainingMs: 59_950 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["oneMinuteWarning"]);
    // Already under a minute on both ticks → no repeat.
    const a = snap({ remainingMs: 59_000 });
    expect(detectClockSoundEvents(a, naturalTick(a, { remainingMs: 58_750 }))).toEqual([]);
  });

  it("does NOT chime when fast-forwarding past the final minute", () => {
    // Director "fast-forward 1 minute": elapsed jumps +60s with no wall time.
    const prev = snap({ remainingMs: 90_000 });
    const next = manualMove(prev, 60_000, { remainingMs: 30_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("does NOT chime on a manual jump into the final minute (row change)", () => {
    const prev = snap({ rowIndex: 0, remainingMs: 8 * 60_000 });
    const next = manualMove(prev, 9 * 60_000, { rowIndex: 2, remainingMs: 40_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("does not warn while paused or on a break", () => {
    const paused = snap({ remainingMs: 61_000, running: false });
    expect(detectClockSoundEvents(paused, naturalTick(paused, { remainingMs: 59_000, running: false }))).toEqual([]);
    const brk = snap({ remainingMs: 61_000, isBreak: true });
    expect(detectClockSoundEvents(brk, naturalTick(brk, { remainingMs: 59_000, isBreak: true }))).toEqual([]);
  });

  it("plays the bust sting when the cumulative bustout count rises", () => {
    const prev = snap({ bustouts: 0 });
    const next = snap({ bustouts: 1 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("busts even with no wall-clock/elapsed change (a manual knockout entry)", () => {
    // The only sound allowed from a manual action.
    const prev = snap({ bustouts: 3, atMs: 1000, elapsedMs: 500 });
    const next = snap({ bustouts: 4, atMs: 1000, elapsedMs: 500 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("still busts when an elimination is immediately offset by a re-entry", () => {
    const prev = snap({ bustouts: 3 });
    const next = snap({ bustouts: 4 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("does not bust on an undo that lowers the count", () => {
    const prev = snap({ bustouts: 4 });
    const next = snap({ bustouts: 3 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("can report a bust alongside a natural level change in the same tick", () => {
    const prev = snap({ rowIndex: 0, remainingMs: 200, bustouts: 2 });
    const next = naturalTick(prev, { rowIndex: 1, remainingMs: 10 * 60_000, bustouts: 3 });
    expect(detectClockSoundEvents(prev, next).sort()).toEqual(["bust", "levelStart"]);
  });
});
