"use client";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { apiFetcher } from "@/lib/api";

/**
 * Global SWR defaults.
 *
 * The settings mirror what the SWR docs call out as a sane production baseline:
 *   - `revalidateOnFocus`     — refresh when the user returns to the tab so
 *                               stats that were edited on another device show
 *                               up without a manual reload.
 *   - `revalidateOnReconnect` — same idea after a network outage.
 *   - `dedupingInterval`      — suppress duplicate requests fired from
 *                               components that mount around the same tick
 *                               (e.g. two pages hitting `/api/players`).
 *   - `keepPreviousData`      — render the previous payload while a refetch
 *                               is in flight, so the UI never flashes a
 *                               "Loading…" placeholder once data has been
 *                               fetched once in this session.
 *   - `errorRetryCount`       — bounded retry so a flaky network doesn't keep
 *                               hammering the API forever.
 */
export default function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        revalidateIfStale: true,
        dedupingInterval: 2_000,
        keepPreviousData: true,
        errorRetryCount: 3,
        shouldRetryOnError: (err: unknown) => {
          // 4xx are deterministic errors (bad input, unauthorised) — retrying
          // won't help. Retry 5xx and network errors.
          const status = (err as { status?: number } | undefined)?.status;
          if (status && status >= 400 && status < 500) return false;
          return true;
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
