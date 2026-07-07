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
import type { Location, Player } from "@/lib/types";

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
  /**
   * Public read-only tournament clock endpoint, keyed by share token. Used by
   * the projector viewer at `/clock/{token}`; needs no auth cookie.
   */
  publicClock: (token: string) => `/api/public/clock/${token}`,
  /**
   * Public tournament-chat feed for the viewer link, keyed by share token.
   * Needs no auth cookie; posting/pinning go through POST on the same path.
   */
  publicChat: (token: string) => `/api/public/chat/${token}`,
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

/** Best-effort JSON parse of a response body; `undefined` when not JSON. */
async function readJsonBody(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return undefined; }
}

/**
 * Pull the server's `{ error: string }` message out of a parsed body, falling
 * back to a caller-supplied default when the body is absent or shaped
 * differently. Single source of truth for the error-message convention every
 * route uses.
 */
function parseApiErrorBody(body: unknown, fallback: string): string {
  return (body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string")
    ? (body as { error: string }).error
    : fallback;
}

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const body = await readJsonBody(res);
    throw new ApiError(parseApiErrorBody(body, `Request failed: ${res.status}`), res.status, body);
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
 * The caches every tournament mutation/delete must refresh, except the
 * mutated tournament's own detail entry (which the two callers handle
 * differently — refresh vs evict). A tournament's existence affects the
 * dashboard stats, the tournaments list, and — because a tournament can
 * introduce a new player or location inline — the players, locations and
 * player-detail caches too.
 */
function refreshTournamentDependents(): Promise<unknown>[] {
  return [
    refreshAllStatsVariants(),
    refresh(apiKeys.tournaments),
    refresh(apiKeys.players),
    refresh(apiKeys.locations),
    refreshPlayerDetails(),
  ];
}

/**
 * Refresh everything that depends on the tournament set, including the single
 * tournament view for `id` when provided.
 */
export async function invalidateAfterTournamentMutation(id?: string) {
  await Promise.all([
    ...refreshTournamentDependents(),
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
    ...refreshTournamentDependents(),
    mutate(apiKeys.tournament(id), undefined, { revalidate: false }),
  ]);
}

/**
 * Targeted invalidation for live-tournament actions (the director console's hot
 * path). Unlike {@link invalidateAfterTournamentMutation}, this only *awaits*
 * the mutated tournament's own detail — the single cache the live manager
 * renders, and the one that threads the fresh `version` into the next action.
 *
 * The heavier dependents (stats, the tournaments list, players, locations,
 * player details) describe other screens that aren't mounted during live play;
 * an in-progress tournament doesn't even enter the stats aggregations until it's
 * finished. So we refresh them in the background (fire-and-forget) instead of
 * blocking every "Pause" / "+1:00" / "Add bustout" click on ~5 extra fetches.
 * Anything mounted elsewhere (e.g. a second tab) still updates; anything
 * unmounted refreshes on its next focus/mount via the global SWR config
 * (revalidateOnFocus + revalidateIfStale).
 */
export async function invalidateAfterLiveAction(id: string) {
  // Background the dependents — deliberately not awaited.
  void Promise.all(refreshTournamentDependents());
  // Await only the detail the live screen renders (threads the next version).
  await refresh(apiKeys.tournament(id));
}

/**
 * POST a single live-tournament action (issue #20) to the version-checked RPC
 * dispatcher, then refresh the live detail (backgrounding the heavier
 * tournament-dependent caches — see {@link invalidateAfterLiveAction}). Returns
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
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new ApiError(parseApiErrorBody(body, `Action failed: ${res.status}`), res.status, body);
  }
  await invalidateAfterLiveAction(id);
  return body as { version: number };
}

/**
 * Create a player via the API and refresh the player-dependent caches.
 * Shared by the tournament wizard, editor and live add-player flow so the
 * fetch + invalidation lives in one place. Throws an {@link ApiError} on a
 * non-2xx response; callers surface their own user-facing message.
 */
export async function createPlayer(name: string): Promise<Player> {
  const res = await fetch("/api/players", { method: "POST", body: JSON.stringify({ name }) });
  if (!res.ok) {
    const body = await readJsonBody(res);
    throw new ApiError(parseApiErrorBody(body, "Failed to create player"), res.status, body);
  }
  const created = await res.json() as Player;
  await invalidateAfterPlayerMutation();
  return created;
}

/**
 * Create a location via the API and refresh the location-dependent caches.
 * Shared by the LocationCombobox `onCreate` handlers in the wizard and editor.
 * Throws with the server's error message on failure.
 */
export async function createLocation(name: string): Promise<Location> {
  const res = await fetch("/api/locations", { method: "POST", body: JSON.stringify({ name }) });
  if (!res.ok) {
    const body = await readJsonBody(res);
    throw new Error(parseApiErrorBody(body, "Failed to create location"));
  }
  const created = await res.json() as Location;
  await invalidateAfterLocationMutation();
  return created;
}

/**
 * Upload (or replace) a tournament's single photo. Sends the raw file as
 * multipart form data to the dedicated image endpoint, then refreshes the
 * tournament-dependent caches so the feed / editor / live manager pick up the
 * new URL. Returns the stored public URL; throws an {@link ApiError} on failure.
 */
export async function uploadTournamentImage(id: string, file: File): Promise<{ image_url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/tournaments/${id}/image`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  const body = await readJsonBody(res);
  if (!res.ok) throw new ApiError(parseApiErrorBody(body, "Failed to upload image"), res.status, body);
  await invalidateAfterTournamentMutation(id);
  return body as { image_url: string };
}

/** Remove a tournament's photo, then refresh the tournament-dependent caches. */
export async function removeTournamentImage(id: string): Promise<void> {
  const res = await fetch(`/api/tournaments/${id}/image`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = await readJsonBody(res);
    throw new ApiError(parseApiErrorBody(body, "Failed to remove image"), res.status, body);
  }
  await invalidateAfterTournamentMutation(id);
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
