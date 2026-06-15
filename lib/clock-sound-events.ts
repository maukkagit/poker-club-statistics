// Pure detection of which clock sound effects should fire on a tick. Given the
// previous and current clock snapshot, decide which events crossed a boundary:
// a new level starting, a break starting/ending, the final-minute warning, or a
// player busting out. No React, no audio, no IO — unit-tested so the (browser-
// only) audio engine can stay a thin player on top of this.

/** A clock sound trigger. Maps 1:1 to a synthesised/overridable sound. */
export type ClockSoundEvent =
  | "levelStart"        // one blind level naturally rolled into the next → level-up jingle
  | "breakStart"        // the countdown naturally reached a break → buzzer
  | "oneMinuteWarning"  // ≤ 1 min left in the current level (natural countdown) → chime
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
   * Elapsed time across the whole structure (ms) at the moment of this
   * snapshot, paired with `atMs` (the wall-clock time it was sampled). Natural
   * progression advances `elapsedMs` by ~the same amount as `atMs`; any manual
   * time movement (adjust, fast-forward/rewind, seeking levels) shifts
   * `elapsedMs` independently of the wall clock, which is how we tell them apart.
   */
  elapsedMs: number;
  /** Wall-clock time (ms) this snapshot was sampled (e.g. Date.now()). */
  atMs: number;
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
 * How far the clock's elapsed time may drift from the real wall-clock time
 * between two ticks while still counting as natural progression. Real ticks
 * track wall-clock within a fraction of a second; any manual time movement
 * (adjust ±1 min, fast-forward/rewind, seeking levels, start, resume) shifts
 * elapsed with no matching wall-clock time passing, so it exceeds this and is
 * ignored. Only the bust sting may fire from a manual action.
 */
const NATURAL_DRIFT_TOLERANCE_MS = 1_500;

/**
 * Which sound events fire moving from `prev` to `next`. With no previous
 * snapshot (first observation after enabling sound) nothing fires — we only
 * react to live transitions, never to the state we happened to load into.
 *
 * Time-driven sounds (levelStart / breakStart / oneMinuteWarning) fire ONLY on
 * natural progression: a started, running clock whose elapsed time advanced by
 * ~the real wall-clock time between the two ticks. ANY manual time movement
 * (start, resume, adjust ±1 min, fast-forward/rewind, seeking a level) moves
 * elapsed independently of the wall clock and is therefore silent. The bust
 * sting is the only sound that may be triggered by a manual action.
 *
 *  - levelStart: one blind level's countdown reached 0 and rolled into the next
 *    blind level. Coming out of a break stays silent, and a level rolling into a
 *    break is breakStart instead.
 *  - breakStart: the countdown naturally reached a break.
 *  - oneMinuteWarning: the running level's countdown crossed 60s within the same
 *    level. Breaks don't warn.
 *  - bust: fires whenever the cumulative bustout count rises — including a bust
 *    immediately offset by a re-entry. Independent of the clock's run state.
 */
export function detectClockSoundEvents(
  prev: ClockSoundSnapshot | null,
  next: ClockSoundSnapshot,
): ClockSoundEvent[] {
  if (!prev) return [];
  const out: ClockSoundEvent[] = [];

  if (next.bustouts > prev.bustouts) out.push("bust");

  // Every time-driven sound requires a started, running clock on both ticks.
  // This alone rules out manual starts and resumes-from-pause (prev wasn't
  // running).
  if (!prev.started || !next.started || !prev.running || !next.running) return out;

  // Natural progression = elapsed advanced by ~the wall-clock time that passed.
  // A manual adjust/seek moves elapsed with little/no wall-clock time elapsed
  // (or even backwards), so the deltas diverge and we bail out silently.
  const wallDelta = next.atMs - prev.atMs;
  const elapsedDelta = next.elapsedMs - prev.elapsedMs;
  const natural = wallDelta >= 0 && Math.abs(elapsedDelta - wallDelta) <= NATURAL_DRIFT_TOLERANCE_MS;
  if (!natural) return out;

  if (next.rowIndex > prev.rowIndex) {
    if (next.isBreak) out.push("breakStart");
    // Level → level only. Coming out of a break (prev.isBreak) stays silent.
    else if (!prev.isBreak) out.push("levelStart");
  } else if (
    next.rowIndex === prev.rowIndex && !next.isBreak && !next.finished &&
    prev.remainingMs > ONE_MINUTE_MS &&
    next.remainingMs <= ONE_MINUTE_MS &&
    next.remainingMs > 0
  ) {
    out.push("oneMinuteWarning");
  }

  return out;
}
