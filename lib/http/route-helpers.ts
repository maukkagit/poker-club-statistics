// Shared helpers for the app/api/**/route.ts handlers. These consolidate the
// query parsing, response shaping and DB-error -> HTTP mapping that was copied
// across routes. Behavior-preserving: each helper reproduces the exact status
// codes and messages the routes returned before.
import { NextResponse } from "next/server";

/** `NextResponse.json(data)` — the success shape used everywhere. */
export function jsonOk(data: unknown): NextResponse {
  return NextResponse.json(data);
}

/** `{ error }` with a status code — the error shape used everywhere. */
export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Read the `includeSpecial` query param. Truthy values "1"/"true" opt the
 * special tournaments back into aggregations; anything else (absent/falsy)
 * keeps the default of excluding them. Mirrors /api/stats, /api/face-off and
 * /api/players/[id].
 */
export function parseIncludeSpecial(req: Request): boolean {
  const raw = new URL(req.url).searchParams.get("includeSpecial");
  return raw === "1" || raw === "true";
}

/**
 * Coerce a `special` flag from a request body. Accepts the strict boolean the
 * editor sends plus the looser "true"/"1"/1 forms a script might use; anything
 * else (including undefined) is false.
 */
export function parseSpecialFlag(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

/**
 * Map a thrown data-layer error to an HTTP response, preserving the exact
 * status codes + client-facing messages the routes used before:
 *  - "location_id is required" -> 400 "Location is required"
 *  - payout_structure* -> 400 (verbatim)
 *  - "Player not found"* / "Location not found"* -> 404 (verbatim)
 *  - "Cannot delete"* -> 409 (verbatim)
 *  - everything else -> 500 with the error message (or `fallback`).
 */
export function handleDbError(e: unknown, fallback = "Operation failed"): NextResponse {
  const msg: string = (e as { message?: string } | null)?.message ?? fallback;
  if (msg === "location_id is required") return jsonError("Location is required", 400);
  if (msg.startsWith("payout_structure")) return jsonError(msg, 400);
  if (msg.startsWith("Player not found")) return jsonError(msg, 404);
  if (msg.startsWith("Location not found")) return jsonError(msg, 404);
  if (msg.startsWith("Cannot delete")) return jsonError(msg, 409);
  return jsonError(msg, 500);
}
