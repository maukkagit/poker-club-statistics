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
  /**
   * Single-player detail endpoint. `includeSpecial` is part of the cache
   * key for the same reason it is on `stats`: the per-player tiles and
   * tournament history must agree with whatever filter the user has
   * selected on the dashboard, and we want both variants cached side-by-
   * side so flipping the toggle is instant.
   */
  player: (id: string, includeSpecial: boolean = false) =>
    `/api/players/${id}?includeSpecial=${includeSpecial ? "1" : "0"}`,
  /**
   * Head-to-head comparison endpoint for the Face Off page. Both ids are
   * part of the cache key so flipping the toggle or swapping players
   * triggers a fresh fetch and lets SWR keep multiple variants cached
   * side-by-side. Empty strings are tolerated — the API returns a
   * zeroed payload when either side is missing.
   */
  faceOff: (a: string, b: string, includeSpecial: boolean = false) =>
    `/api/face-off?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&includeSpecial=${includeSpecial ? "1" : "0"}`,
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
 * Revalidate every cached `/api/players/{id}` key that SWR currently has
 * in memory, regardless of which `includeSpecial` variant it points at.
 *
 * Mutation sites don't know which player detail page (if any) the user
 * has open, so we let SWR walk its cache and re-fetch anything that
 * matches the URL prefix. `revalidate: true` triggers the network call;
 * SWR is happy to no-op for keys nobody is subscribed to.
 */
function refreshPlayerDetails() {
  return mutate(
    key => typeof key === "string" && key.startsWith("/api/players/"),
    undefined,
    { revalidate: true },
  );
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
    refreshPlayerDetails(),
    id ? refresh(apiKeys.tournament(id)) : Promise.resolve(),
  ]);
}

/**
 * Same fan-out as {@link invalidateAfterTournamentMutation}, but for the
 * delete path. The tournament's own detail endpoint will 404 (the resource
 * is gone), so refreshing it would throw and reject the whole `Promise.all`.
 * Instead we evict the cached detail entry by writing `undefined` with
 * `revalidate: false`, so any subscribed component immediately stops
 * rendering stale data and SWR doesn't re-fetch behind the scenes.
 */
export async function invalidateAfterTournamentDelete(id: string) {
  await Promise.all([
    refreshAllStatsVariants(),
    refresh(apiKeys.tournaments),
    refresh(apiKeys.players),
    refresh(apiKeys.locations),
    refreshPlayerDetails(),
    mutate(apiKeys.tournament(id), undefined, { revalidate: false }),
  ]);
}

/**
 * POST a single live-tournament action (issue #20) to the version-checked RPC
 * dispatcher, then refresh everything that depends on the tournament. Returns
 * the new server `version`. Throws an {@link ApiError} on failure — a 409 means
 * the version was stale (someone else edited it).
 */
export async function postLiveAction(
  id: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ version: number }> {
  const res = await fetch(`/api/tournaments/${id}/live`, {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({ action, ...payload }),
  });
  let body: any = undefined;
  try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Action failed: ${res.status}`, res.status, body);
  }
  await invalidateAfterTournamentMutation(id);
  return body as { version: number };
}

export async function invalidateAfterPlayerMutation() {
  // Deleting/adding a player changes the players list and, since a deletion
  // also removes the player's entries, the dashboard stats too. The detail
  // page also displays the player's name, so refresh that variant set.
  await Promise.all([
    refresh(apiKeys.players),
    refreshAllStatsVariants(),
    refreshPlayerDetails(),
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
