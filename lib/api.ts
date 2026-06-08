/**
 * Client-side data layer.
 *
 * - `apiKeys` is the single source of truth for SWR cache keys, so a typo can
 *   never silently break invalidation.
 * - `apiFetcher` is the default fetcher used by SWRConfig.
 * - `invalidate*` helpers wrap `mutate()` and live next to the keys, so a
 *   future contributor adding a new endpoint only has to edit one file to make
 *   the cache react to it correctly.
 */

import { mutate } from "swr";

export const apiKeys = {
  /**
   * Dashboard stats endpoint. The `includeSpecial` arg is part of the cache
   * key — flipping the dashboard toggle changes the URL, which makes SWR
   * fetch a fresh response and keep both variants cached side-by-side.
   * Defaults to `false` so callers that don't care about the toggle (e.g.
   * cache invalidation) hit the same key the dashboard uses on first load.
   */
  stats: (includeSpecial: boolean = false) =>
    `/api/stats?includeSpecial=${includeSpecial ? "1" : "0"}`,
  tournaments: "/api/tournaments",
  tournament: (id: string) => `/api/tournaments/${id}`,
  players: "/api/players",
  locations: "/api/locations",
} as const;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    let body: unknown = undefined;
    try { body = await res.json(); } catch { /* not json */ }
    const msg = (body && typeof body === "object" && "error" in body && typeof (body as any).error === "string")
      ? (body as any).error
      : `Request failed: ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<T>;
}

/**
 * Eagerly refresh a key by fetching the new data and writing it into the SWR
 * cache, then notifying every subscriber.
 *
 * `mutate(key)` alone is a no-op when no component is currently subscribed to
 * `key` (e.g. user just saved a tournament on /tournaments/[id] but the
 * dashboard is unmounted). We want the next navigation to render fresh data
 * instantly with no "stale flash", so we kick off the fetch ourselves and
 * hand SWR the resulting promise. SWR will adopt it as the new cache entry
 * for any future subscribers.
 */
function refresh<T = unknown>(key: string) {
  return mutate(key, apiFetcher<T>(key), { revalidate: false });
}

/**
 * Refresh both stats variants (with and without special tournaments) at
 * once. The dashboard caches one of them depending on the user's toggle,
 * and we don't know which is currently active from a mutation site, so we
 * keep both fresh.
 */
function refreshAllStatsVariants() {
  return Promise.all([
    refresh(apiKeys.stats(false)),
    refresh(apiKeys.stats(true)),
  ]);
}

/**
 * Refresh everything that depends on the tournament set. A tournament's
 * existence affects the dashboard stats, the tournaments list, the single
 * tournament view, and — because a tournament can introduce a new player or
 * a new location inline — the players and locations lists too.
 */
export async function invalidateAfterTournamentMutation(id?: string) {
  await Promise.all([
    refreshAllStatsVariants(),
    refresh(apiKeys.tournaments),
    refresh(apiKeys.players),
    refresh(apiKeys.locations),
    id ? refresh(apiKeys.tournament(id)) : Promise.resolve(),
  ]);
}

export async function invalidateAfterPlayerMutation() {
  // Deleting/adding a player changes the players list and, since a deletion
  // also removes the player's entries, the dashboard stats too.
  await Promise.all([
    refresh(apiKeys.players),
    refreshAllStatsVariants(),
  ]);
}

/**
 * Adding, renaming or deleting a location changes the locations list and the
 * tournaments list (each row carries a denormalised `location_name`).
 */
export async function invalidateAfterLocationMutation() {
  await Promise.all([
    refresh(apiKeys.locations),
    refresh(apiKeys.tournaments),
  ]);
}
