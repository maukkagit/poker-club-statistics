"use client";
import { useCallback, useEffect, useRef } from "react";
import type { StructureRow, TournamentClock } from "@/lib/types";
import { deriveClockView } from "@/lib/tournament-clock";
import { ClockSoundPlayer } from "@/lib/clock-sounds";
import { detectClockSoundEvents, type ClockSoundSnapshot } from "@/lib/clock-sound-events";
import { useClockTicker } from "@/components/useClockTicker";

/**
 * Drives projector-clock sound effects (public viewer only). Ticks the clock
 * locally to spot level/break transitions and the final-minute warning, and
 * watches the remaining-player count for bustouts, playing the matching sound.
 *
 * Sound is opt-in and starts muted: browsers block audio until a user gesture,
 * so the caller must invoke the returned `unlock()` from a click (the page's
 * sound toggle) before anything is audible. While `enabled` is false the
 * detector stays dormant and re-baselines on the next enable, so toggling sound
 * on mid-level never fires for state that was already on screen.
 */
export function useClockSounds(opts: {
  enabled: boolean;
  /** When false, bustout stings are suppressed (other sounds still play). */
  knockoutsEnabled?: boolean;
  structure: StructureRow[];
  clock: TournamentClock | null;
  /** Cumulative bustouts so far (monotonic; survives a bust + re-entry). */
  bustouts: number;
}): { unlock: () => void } {
  const { enabled, knockoutsEnabled = true, structure, clock, bustouts } = opts;
  const playerRef = useRef<ClockSoundPlayer | null>(null);
  const prevRef = useRef<ClockSoundSnapshot | null>(null);

  useEffect(() => {
    playerRef.current = new ClockSoundPlayer();
    return () => { playerRef.current?.close(); playerRef.current = null; };
  }, []);

  const running = !!clock?.running && !!clock?.started;
  const now = useClockTicker(enabled && running, 250);

  useEffect(() => {
    if (!enabled) { prevRef.current = null; return; }
    const view = deriveClockView(structure, clock, now);
    const snap: ClockSoundSnapshot = {
      started: view.started,
      running: view.running,
      finished: view.finished,
      isBreak: view.isBreak,
      rowIndex: view.rowIndex,
      remainingMs: view.remainingMs,
      // Paired elapsed/wall-clock readings let the detector verify the clock
      // advanced by real time (natural) vs. jumped (a manual adjust/seek).
      elapsedMs: view.effectiveElapsedMs,
      atMs: now,
      bustouts,
    };
    const events = detectClockSoundEvents(prevRef.current, snap);
    prevRef.current = snap;
    const player = playerRef.current;
    if (player?.ready) {
      for (const e of events) {
        if (e === "bust" && !knockoutsEnabled) continue;
        player.play(e);
      }
    }
  }, [enabled, knockoutsEnabled, structure, clock, bustouts, now]);

  // Stable identity so callers' gesture-listener effects don't tear down and
  // re-subscribe on every render (this hook re-renders ~4×/sec while running).
  const unlock = useCallback(() => { void playerRef.current?.unlock(); }, []);
  return { unlock };
}
