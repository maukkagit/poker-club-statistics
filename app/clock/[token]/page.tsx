"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { apiKeys, ApiError } from "@/lib/api";
import { useClockChannel } from "@/components/useClockChannel";
import { useClockSounds } from "@/components/useClockSounds";
import TournamentClock from "@/components/TournamentClock";
import TournamentChat from "@/components/TournamentChat";
import type { PublicClock } from "@/lib/types";

const SOUND_PREF_KEY = "pcs:clock-sound-on";

/**
 * Public, read-only projector clock reached via a share token (no login). It
 * polls the public endpoint as a baseline and also subscribes to the realtime
 * channel so director actions (pause/resume/rewind, busts, re-entries) reflect
 * here within a fraction of a second. Rendered as a full-screen overlay so it
 * fills a projector regardless of the surrounding app chrome.
 *
 * Unlike the director console, the viewer link can play sound effects (gong on
 * a new level, buzzer on break start/end, chime in the final minute, a sting on
 * a bustout). Sound is opt-in via the speaker toggle (browsers require a gesture).
 */
export default function PublicClockPage() {
  const { token } = useParams<{ token: string }>();
  const key = token ? apiKeys.publicClock(token) : null;
  const { data, error, isLoading, mutate } = useSWR<PublicClock>(key, {
    refreshInterval: 5000,
  });

  const refetch = useCallback(() => { void mutate(); }, [mutate]);
  useClockChannel(token, refetch);

  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    try { setSoundOn(window.localStorage.getItem(SOUND_PREF_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  // The director can disable sounds (or just the knockout sting) for everyone
  // from the live manager; the viewer's own toggle gates on top of that.
  const directorSound = data?.soundEnabled !== false;
  const { unlock } = useClockSounds({
    enabled: soundOn && directorSound,
    knockoutsEnabled: data?.soundKnockouts !== false,
    structure: data?.structure ?? [],
    clock: data?.clock ?? null,
    playersRemaining: data?.aggregates.playersRemaining ?? 0,
  });

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      if (next) unlock();
      try { window.localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [unlock]);

  // Full-screen mode requests the Fullscreen API on the clock wrapper, which
  // hides the browser chrome (URL bar etc.) and — because the chat lives
  // outside the wrapper — shows only the header bars and the clock. On Android
  // we also try to lock the orientation to landscape.
  //
  // iOS Safari supports neither the Fullscreen API on non-video elements nor
  // orientation lock, so there we fall back to a "pseudo" full-screen: a fixed
  // overlay that, when the phone is in portrait, rotates the clock 90° to make
  // it landscape and fill the screen.
  const clockRef = useRef<HTMLDivElement>(null);
  const [realFs, setRealFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const isFullscreen = realFs || pseudoFs;

  useEffect(() => {
    const onChange = () => setRealFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => setPortrait(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement || pseudoFs) {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      try { (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.(); } catch { /* ignore */ }
      setPseudoFs(false);
      return;
    }
    const el = clockRef.current;
    if (el && typeof el.requestFullscreen === "function") {
      el.requestFullscreen().then(() => {
        // Best-effort landscape lock (supported on Android Chrome, ignored elsewhere).
        try {
          (screen.orientation as { lock?: (o: string) => Promise<void> } | undefined)
            ?.lock?.("landscape").catch(() => {});
        } catch { /* ignore */ }
      }).catch(() => setPseudoFs(true));
    } else {
      // iOS Safari: no element fullscreen — use the rotated overlay fallback.
      setPseudoFs(true);
    }
  }, [pseudoFs]);

  const controls = (
    <div className="fixed top-3 right-3 z-[60] flex gap-2">
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn && directorSound}
        disabled={!directorSound}
        title={!directorSound
          ? "Sound effects are turned off by the tournament director"
          : soundOn ? "Mute clock sound effects" : "Enable clock sound effects"}
        className="btn btn-secondary !px-3 !py-2 disabled:opacity-50"
      >
        <span aria-hidden className="text-lg leading-none">{soundOn && directorSound ? "🔊" : "🔇"}</span>
        <span className="sr-only">{soundOn && directorSound ? "Sound on" : "Sound off"}</span>
      </button>
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-pressed={isFullscreen}
        title={isFullscreen ? "Exit full-screen mode" : "Full-screen mode"}
        className="btn btn-secondary !px-3 !py-2"
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isFullscreen ? (
            <>
              <path d="M9 3v4a2 2 0 0 1-2 2H3" />
              <path d="M15 3v4a2 2 0 0 0 2 2h4" />
              <path d="M9 21v-4a2 2 0 0 0-2-2H3" />
              <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
            </>
          ) : (
            <>
              <path d="M3 9V5a2 2 0 0 1 2-2h4" />
              <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
              <path d="M3 15v4a2 2 0 0 0 2 2h4" />
              <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
            </>
          )}
        </svg>
        <span className="sr-only">{isFullscreen ? "Exit full-screen" : "Full-screen mode"}</span>
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4 sm:p-8" style={{ background: "var(--bg)" }}>
      {error ? (
        <div className="card neg max-w-md mx-auto mt-20 text-center">
          {error instanceof ApiError && error.status === 404
            ? "This clock link is invalid or the tournament was removed."
            : "Couldn't load the tournament clock."}
        </div>
      ) : isLoading || !data ? (
        <div className="muted text-center mt-20">Loading clock…</div>
      ) : (
        <div className="max-w-7xl mx-auto space-y-4">
          <div
            ref={clockRef}
            className={isFullscreen ? "overflow-auto p-4 sm:p-8" : ""}
            style={
              pseudoFs
                ? {
                    background: "var(--bg)",
                    position: "fixed",
                    zIndex: 55,
                    transformOrigin: "top left",
                    // Portrait phones get rotated 90° into landscape so the
                    // clock uses the full screen; landscape just fills it.
                    ...(portrait
                      ? {
                          top: 0,
                          left: 0,
                          width: "100dvh",
                          height: "100dvw",
                          transform: "translateX(100dvw) rotate(90deg)",
                        }
                      : { inset: 0 }),
                  }
                : realFs
                  ? { background: "var(--bg)" }
                  : undefined
            }
          >
            {controls}
            {/* Centered, width-capped so the clock stays centered when the
                wrapper fills the whole screen in full-screen mode. */}
            <div className="max-w-7xl mx-auto space-y-4">
              <TournamentClock
                title={data.title}
                subtitle={data.subtitle}
                structure={data.structure}
                clock={data.clock}
                aggregates={data.aggregates}
                payouts={data.payouts}
                bounty={data.bounty ?? null}
                prizePoolDisplay={data.prizePoolTotal ?? null}
                payoutsLabel={data.isPko ? "Payouts (excl. bounties)" : undefined}
              />
            </div>
          </div>
          {/* Keep the chat mounted (just hidden) in full-screen so returning to
              the normal view doesn't remount it and auto-focus its input. */}
          {token && (
            <div className={isFullscreen ? "hidden" : ""}>
              <TournamentChat token={token} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
