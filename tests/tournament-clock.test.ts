import { describe, it, expect } from "vitest";
import {
  structureTotalMs, effectiveElapsedMs, deriveClockView, effectiveClockLevel,
  rebuyWindowAutoToggle, formatClock,
  computeClockAggregates, applyClockAction, rowStartMs, type ClockEntryLike,
} from "@/lib/tournament-clock";
import type { StructureRow, TournamentClock } from "@/lib/types";

const MIN = 60_000;

// 3 levels of 20 min with a 10 min break after level 2:
// [L1 0-20] [L2 20-40] [BREAK 40-50] [L3 50-70]
const structure: StructureRow[] = [
  { kind: "level", sb: 100, bb: 200, ante: 0, duration_min: 20 },
  { kind: "level", sb: 200, bb: 400, ante: 0, duration_min: 20 },
  { kind: "break", duration_min: 10 },
  { kind: "level", sb: 300, bb: 600, ante: 600, duration_min: 20 },
];

function clock(over: Partial<TournamentClock>): TournamentClock {
  return {
    started: over.started ?? true,
    running: over.running ?? false,
    elapsed_ms: over.elapsed_ms ?? 0,
    updated_at: over.updated_at ?? null,
  };
}

describe("structureTotalMs", () => {
  it("sums every row", () => {
    expect(structureTotalMs(structure)).toBe(70 * MIN);
  });
});

describe("effectiveElapsedMs", () => {
  it("is 0 before start", () => {
    expect(effectiveElapsedMs(structure, clock({ started: false }), 1_000_000)).toBe(0);
  });
  it("returns the stored counter when paused", () => {
    expect(effectiveElapsedMs(structure, clock({ elapsed_ms: 5 * MIN }), 9e12)).toBe(5 * MIN);
  });
  it("adds wall-clock time while running", () => {
    const now = 1_000_000;
    const c = clock({ running: true, elapsed_ms: 5 * MIN, updated_at: new Date(now - 60_000).toISOString() });
    expect(effectiveElapsedMs(structure, c, now)).toBe(6 * MIN);
  });
  it("clamps to the total", () => {
    expect(effectiveElapsedMs(structure, clock({ elapsed_ms: 999 * MIN }), 0)).toBe(70 * MIN);
  });
});

describe("deriveClockView", () => {
  it("shows the opening level before start", () => {
    const v = deriveClockView(structure, clock({ started: false }), 0);
    expect(v.started).toBe(false);
    expect(v.levelNumber).toBe(1);
    expect(v.remainingMs).toBe(20 * MIN);
    expect(v.nextLevel?.bb).toBe(400);
    expect(v.breakInMs).toBe(40 * MIN);
  });

  it("locates the current level mid-way", () => {
    // 25 minutes in => level 2, 15 min remaining, next level is L3, break in 15 min.
    const v = deriveClockView(structure, clock({ elapsed_ms: 25 * MIN }), 0);
    expect(v.isBreak).toBe(false);
    expect(v.levelNumber).toBe(2);
    expect(v.level?.bb).toBe(400);
    expect(v.remainingMs).toBe(15 * MIN);
    expect(v.nextLevel?.bb).toBe(600);
    expect(v.breakInMs).toBe(15 * MIN);
  });

  it("detects a break", () => {
    // 45 min in => inside the break (40-50), 5 min remaining, no level number.
    const v = deriveClockView(structure, clock({ elapsed_ms: 45 * MIN }), 0);
    expect(v.isBreak).toBe(true);
    expect(v.levelNumber).toBeNull();
    expect(v.level).toBeNull();
    expect(v.remainingMs).toBe(5 * MIN);
    expect(v.nextLevel?.bb).toBe(600);
    expect(v.breakInMs).toBeNull(); // already in the only break — none ahead
  });

  it("pins to the last level when finished", () => {
    const v = deriveClockView(structure, clock({ elapsed_ms: 70 * MIN }), 0);
    expect(v.finished).toBe(true);
    expect(v.remainingMs).toBe(0);
    expect(v.levelNumber).toBe(3);
    expect(v.nextLevel).toBeNull();
    expect(v.breakInMs).toBeNull();
  });

  it("reports not configured for an empty structure", () => {
    const v = deriveClockView([], clock({}), 0);
    expect(v.configured).toBe(false);
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(90_000)).toBe("1:30");
    expect(formatClock(5_000)).toBe("0:05");
  });
  it("formats hours past 60 minutes", () => {
    expect(formatClock(3_661_000)).toBe("1:01:01");
  });
  it("never goes negative", () => {
    expect(formatClock(-5000)).toBe("0:00");
  });
});

describe("applyClockAction", () => {
  const now = 1_000_000;
  it("starts from zero, running", () => {
    const c = applyClockAction(structure, null, { type: "start" }, now);
    expect(c).toMatchObject({ started: true, running: true, elapsed_ms: 0 });
    expect(c.updated_at).toBe(new Date(now).toISOString());
  });
  it("folds elapsed when pausing a running clock", () => {
    const running = clock({ running: true, elapsed_ms: 5 * MIN, updated_at: new Date(now - 60_000).toISOString() });
    const c = applyClockAction(structure, running, { type: "setRunning", running: false }, now);
    expect(c.running).toBe(false);
    expect(c.elapsed_ms).toBe(6 * MIN);
  });
  it("rewinds without going negative", () => {
    const c = applyClockAction(structure, clock({ elapsed_ms: 30_000 }), { type: "adjust", deltaMs: -60_000 }, now);
    expect(c.elapsed_ms).toBe(0);
  });
  it("fast-forwards clamped to the total", () => {
    const c = applyClockAction(structure, clock({ elapsed_ms: 69 * MIN }), { type: "adjust", deltaMs: 5 * MIN }, now);
    expect(c.elapsed_ms).toBe(70 * MIN);
  });
  it("seeks to an absolute position and pauses (restart level)", () => {
    const running = clock({ running: true, elapsed_ms: 25 * MIN });
    const c = applyClockAction(structure, running, { type: "setElapsed", elapsedMs: 20 * MIN, running: false }, now);
    expect(c).toMatchObject({ started: true, running: false, elapsed_ms: 20 * MIN });
  });
  it("clamps a seek to the structure bounds", () => {
    const lo = applyClockAction(structure, null, { type: "setElapsed", elapsedMs: -5 * MIN, running: false }, now);
    expect(lo.elapsed_ms).toBe(0);
    const hi = applyClockAction(structure, null, { type: "setElapsed", elapsedMs: 999 * MIN, running: false }, now);
    expect(hi.elapsed_ms).toBe(70 * MIN);
  });
});

describe("rowStartMs", () => {
  it("returns the cumulative start time of each row", () => {
    expect(rowStartMs(structure, 0)).toBe(0);
    expect(rowStartMs(structure, 1)).toBe(20 * MIN);
    expect(rowStartMs(structure, 2)).toBe(40 * MIN);
    expect(rowStartMs(structure, 3)).toBe(50 * MIN);
  });
});

describe("computeClockAggregates", () => {
  const entries: ClockEntryLike[] = [
    { buy_ins: 2, finish_position: null }, // re-entered, still in
    { buy_ins: 1, finish_position: null }, // still in
    { buy_ins: 1, finish_position: 3 },    // busted
  ];
  it("computes remaining, re-entries, chips and average", () => {
    const a = computeClockAggregates(entries, { buyInAmount: 30, startingStack: 20000 });
    expect(a.playersTotal).toBe(3);
    expect(a.playersRemaining).toBe(2);
    expect(a.totalBuyIns).toBe(4);
    expect(a.reEntries).toBe(1);
    expect(a.chipsInPlay).toBe(80000);
    expect(a.averageStack).toBe(40000);
    expect(a.prizePool).toBe(120);
  });
  it("handles no remaining players without dividing by zero", () => {
    const a = computeClockAggregates([{ buy_ins: 1, finish_position: 1 }], { buyInAmount: 30, startingStack: 20000 });
    expect(a.averageStack).toBe(0);
  });
  it("treats a missing stack as zero chips", () => {
    const a = computeClockAggregates(entries, { buyInAmount: 30, startingStack: null });
    expect(a.chipsInPlay).toBe(0);
    expect(a.averageStack).toBe(0);
  });
});

describe("effectiveClockLevel", () => {
  it("returns the blind level number on a level row", () => {
    const view = deriveClockView(structure, clock({ elapsed_ms: 25 * MIN }), 0);
    expect(effectiveClockLevel(view, structure)).toBe(2);
  });

  it("returns completed levels on a break row", () => {
    const view = deriveClockView(structure, clock({ elapsed_ms: 45 * MIN }), 0);
    expect(view.levelNumber).toBeNull();
    expect(effectiveClockLevel(view, structure)).toBe(2);
  });
});

describe("rebuyWindowAutoToggle", () => {
  it("closes when crossing into the close level", () => {
    expect(rebuyWindowAutoToggle({
      closeLevel: 10, prevLevel: 9, newLevel: 10, windowOpen: true, inMoneyDetermined: false,
    })).toBe(false);
  });

  it("reopens when rewinding before the close level", () => {
    expect(rebuyWindowAutoToggle({
      closeLevel: 10, prevLevel: 10, newLevel: 9, windowOpen: false, inMoneyDetermined: false,
    })).toBe(true);
  });

  it("does nothing when staying below the close level", () => {
    expect(rebuyWindowAutoToggle({
      closeLevel: 10, prevLevel: 8, newLevel: 9, windowOpen: true, inMoneyDetermined: false,
    })).toBeNull();
  });
});
