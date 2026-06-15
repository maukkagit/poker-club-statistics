"use client";
import { useCallback, useEffect, useState } from "react";
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

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4 sm:p-8" style={{ background: "var(--bg)" }}>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn && directorSound}
        disabled={!directorSound}
        title={!directorSound
          ? "Sound effects are turned off by the tournament director"
          : soundOn ? "Mute clock sound effects" : "Enable clock sound effects"}
        className="btn btn-secondary fixed top-3 right-3 z-[60] !px-3 !py-2 disabled:opacity-50"
      >
        <span aria-hidden className="text-lg leading-none">{soundOn && directorSound ? "🔊" : "🔇"}</span>
        <span className="sr-only">{soundOn && directorSound ? "Sound on" : "Sound off"}</span>
      </button>

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
          {token && <TournamentChat token={token} />}
        </div>
      )}
    </div>
  );
}
