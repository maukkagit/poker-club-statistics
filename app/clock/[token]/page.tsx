"use client";
import { useCallback } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { apiKeys, ApiError } from "@/lib/api";
import { useClockChannel } from "@/components/useClockChannel";
import TournamentClock from "@/components/TournamentClock";
import TournamentChat from "@/components/TournamentChat";
import type { PublicClock } from "@/lib/types";

/**
 * Public, read-only projector clock reached via a share token (no login). It
 * polls the public endpoint as a baseline and also subscribes to the realtime
 * channel so director actions (pause/resume/rewind, busts, re-entries) reflect
 * here within a fraction of a second. Rendered as a full-screen overlay so it
 * fills a projector regardless of the surrounding app chrome.
 */
export default function PublicClockPage() {
  const { token } = useParams<{ token: string }>();
  const key = token ? apiKeys.publicClock(token) : null;
  const { data, error, isLoading, mutate } = useSWR<PublicClock>(key, {
    refreshInterval: 5000,
  });

  const refetch = useCallback(() => { void mutate(); }, [mutate]);
  useClockChannel(token, refetch);

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
          <TournamentClock
            title={data.title}
            structure={data.structure}
            clock={data.clock}
            aggregates={data.aggregates}
            payouts={data.payouts}
          />
          {token && <TournamentChat token={token} />}
        </div>
      )}
    </div>
  );
}
