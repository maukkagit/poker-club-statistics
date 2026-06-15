// Pure detection of which clock sound effects should fire on a tick. Given the
// previous and current clock snapshot, decide which events crossed a boundary:
// a new level starting, a break starting/ending, the final-minute warning, or a
// player busting out. No React, no audio, no IO — unit-tested so the (browser-
// only) audio engine can stay a thin player on top of this.

/** A clock sound trigger. Maps 1:1 to a synthesised/overridable sound. */
export type ClockSoundEvent =
  | "levelStart"        // a new blind level began (incl. resuming after a break) → gong
  | "breakStart"        // a break began → buzzer
  | "oneMinuteWarning"  // ≤ 1 min left in the current level → chime
  | "bust";             // a player busted out → "fatality" sting

/** The minimal slice of the clock view the detector compares between ticks. */
export type ClockSoundSnapshot = {
  started: boolean;
  running: boolean;
  finished: boolean;
  isBreak: boolean;
  rowIndex: number;
  remainingMs: number;
  /**
   * Cumulative bustouts so far (a monotonically non-decreasing count of
   * eliminations). Using a running total — not the net players-remaining count
   * — means a bustout still registers even when the player re-enters in the
   * same refresh (the re-entry bumps total buy-ins, not this tally back down).
   */
  bustouts: number;
};

const ONE_MINUTE_MS = 60_000;

/**
 * Which sound events fire moving from `prev` to `next`. With no previous
 * snapshot (first observation after enabling sound) nothing fires — we only
 * react to live transitions, never to the state we happened to load into.
 *
 *  - Forward row advance (or the clock being started) into a level → levelStart,
 *    including resuming play after a break (breaks ending don't buzz). Into a
 *    break → breakStart. Backward seeks (director rewinds) are ignored.
 *  - oneMinuteWarning fires once as the running level's countdown crosses 60s.
 *    Breaks don't warn (the request is specifically about a level ending).
 *  - bust fires whenever the cumulative bustout count rises — including a bust
 *    that's immediately offset by a re-entry (the net player count wouldn't
 *    change, but the running bustout tally still ticks up).
 */
export function detectClockSoundEvents(
  prev: ClockSoundSnapshot | null,
  next: ClockSoundSnapshot,
): ClockSoundEvent[] {
  if (!prev) return [];
  const out: ClockSoundEvent[] = [];

  if (next.bustouts > prev.bustouts) out.push("bust");

  if (!next.started) return out;

  const enteredPlay = !prev.started && next.started;
  const advanced = next.rowIndex > prev.rowIndex;

  if (enteredPlay || advanced) {
    if (next.isBreak) out.push("breakStart");
    else out.push("levelStart");
  } else if (
    next.running && !next.isBreak && !next.finished &&
    prev.remainingMs > ONE_MINUTE_MS &&
    next.remainingMs <= ONE_MINUTE_MS &&
    next.remainingMs > 0
  ) {
    out.push("oneMinuteWarning");
  }

  return out;
}
