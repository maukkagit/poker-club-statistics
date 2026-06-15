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
    bustouts: 0,
    ...over,
  };
}

describe("detectClockSoundEvents", () => {
  it("fires nothing without a previous snapshot (baseline on enable)", () => {
    expect(detectClockSoundEvents(null, snap())).toEqual([]);
  });

  it("gongs when a new level starts (forward row advance to a level)", () => {
    const prev = snap({ rowIndex: 0 });
    const next = snap({ rowIndex: 1 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["levelStart"]);
  });

  it("gongs when the clock is first started into level 1", () => {
    const prev = snap({ started: false, running: false });
    const next = snap({ started: true, running: true, rowIndex: 0 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["levelStart"]);
  });

  it("buzzes when a break starts", () => {
    const prev = snap({ rowIndex: 1, isBreak: false });
    const next = snap({ rowIndex: 2, isBreak: true });
    expect(detectClockSoundEvents(prev, next)).toEqual(["breakStart"]);
  });

  it("gongs (not buzzes) when a break ends and the next level starts", () => {
    const prev = snap({ rowIndex: 2, isBreak: true });
    const next = snap({ rowIndex: 3, isBreak: false });
    expect(detectClockSoundEvents(prev, next)).toEqual(["levelStart"]);
  });

  it("ignores backward seeks (director rewind)", () => {
    const prev = snap({ rowIndex: 3 });
    const next = snap({ rowIndex: 1 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("chimes once as the running level crosses the final minute", () => {
    const prev = snap({ remainingMs: 61_000 });
    const next = snap({ remainingMs: 59_000 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["oneMinuteWarning"]);
    // Already under a minute on both ticks → no repeat.
    expect(detectClockSoundEvents(snap({ remainingMs: 59_000 }), snap({ remainingMs: 57_000 }))).toEqual([]);
  });

  it("does not warn while paused or on a break", () => {
    expect(detectClockSoundEvents(snap({ remainingMs: 61_000, running: false }), snap({ remainingMs: 59_000, running: false }))).toEqual([]);
    expect(detectClockSoundEvents(snap({ remainingMs: 61_000, isBreak: true }), snap({ remainingMs: 59_000, isBreak: true }))).toEqual([]);
  });

  it("plays the bust sting when the cumulative bustout count rises", () => {
    const prev = snap({ bustouts: 0 });
    const next = snap({ bustouts: 1 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("still busts when an elimination is immediately offset by a re-entry", () => {
    // Net players-remaining is unchanged, but the running bustout tally ticks up.
    const prev = snap({ bustouts: 3 });
    const next = snap({ bustouts: 4 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("does not bust on an undo that lowers the count", () => {
    const prev = snap({ bustouts: 4 });
    const next = snap({ bustouts: 3 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("can report a bust alongside a level change in the same tick", () => {
    const prev = snap({ rowIndex: 0, bustouts: 2 });
    const next = snap({ rowIndex: 1, bustouts: 3 });
    expect(detectClockSoundEvents(prev, next).sort()).toEqual(["bust", "levelStart"]);
  });
});
