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
    playersRemaining: 9,
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

  it("buzzes when a break ends (resuming into a level)", () => {
    const prev = snap({ rowIndex: 2, isBreak: true });
    const next = snap({ rowIndex: 3, isBreak: false });
    expect(detectClockSoundEvents(prev, next)).toEqual(["breakEnd"]);
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

  it("plays the bust sting when the remaining-player count drops", () => {
    const prev = snap({ playersRemaining: 9 });
    const next = snap({ playersRemaining: 8 });
    expect(detectClockSoundEvents(prev, next)).toEqual(["bust"]);
  });

  it("does not bust on a re-entry / undo that raises the count", () => {
    const prev = snap({ playersRemaining: 8 });
    const next = snap({ playersRemaining: 9 });
    expect(detectClockSoundEvents(prev, next)).toEqual([]);
  });

  it("can report a bust alongside a level change in the same tick", () => {
    const prev = snap({ rowIndex: 0, playersRemaining: 9 });
    const next = snap({ rowIndex: 1, playersRemaining: 8 });
    expect(detectClockSoundEvents(prev, next).sort()).toEqual(["bust", "levelStart"]);
  });
});
