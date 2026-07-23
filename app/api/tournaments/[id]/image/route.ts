import { NextResponse } from "next/server";
import { getTournament, setTournamentImageUrl, setTournamentImageFocus } from "@/lib/db";
import { uploadTournamentImage, removeTournamentImageObjects } from "@/lib/db/tournament-images";
import { clampFocus, normalizeFocus } from "@/lib/image-focus";
import { handleDbError, jsonError } from "@/lib/http/route-helpers";

export const dynamic = "force-dynamic";

// Cap uploads so a stray huge file can't blow up the request/storage. Phone
// photos comfortably fit; anything bigger is almost certainly a mistake.
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Map the accepted image content-types to a file extension for the stored
// object. Anything image/* we don't recognise falls back to .jpg.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

function parseFocusField(raw: FormDataEntryValue | null): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return clampFocus(n);
}

/** Upload (or replace) the tournament's single photo. Body: multipart `file`
 *  plus optional `focus_x` / `focus_y` (0–100 percentages). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const t = await getTournament(params.id);
  if (!t) return jsonError("not found", 404);
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return jsonError("No file provided", 400);
    const type = file.type || "";
    if (!type.startsWith("image/")) return jsonError("File must be an image", 400);
    if (file.size > MAX_BYTES) return jsonError("Image too large (max 10 MB)", 400);

    const focus = normalizeFocus(
      parseFocusField(form.get("focus_x")),
      parseFocusField(form.get("focus_y")),
    );

    const ext = EXT_BY_TYPE[type] ?? "jpg";
    const bytes = await file.arrayBuffer();
    const url = await uploadTournamentImage(params.id, bytes, type, ext);
    await setTournamentImageUrl(params.id, url, focus);
    return NextResponse.json({
      image_url: url,
      image_focus_x: focus.x,
      image_focus_y: focus.y,
    });
  } catch (e) {
    return handleDbError(e, "Failed to upload image");
  }
}

/** Update only the focal point of an existing photo. Body: JSON
 *  `{ focus_x, focus_y }` (0–100). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const t = await getTournament(params.id);
  if (!t) return jsonError("not found", 404);
  if (!t.image_url) return jsonError("No photo to adjust", 400);
  try {
    const body = await req.json().catch(() => null) as { focus_x?: unknown; focus_y?: unknown } | null;
    if (!body || typeof body !== "object") return jsonError("Invalid body", 400);
    const focus = normalizeFocus(Number(body.focus_x), Number(body.focus_y));
    await setTournamentImageFocus(params.id, focus);
    return NextResponse.json({
      image_url: t.image_url,
      image_focus_x: focus.x,
      image_focus_y: focus.y,
    });
  } catch (e) {
    return handleDbError(e, "Failed to update focal point");
  }
}

/** Remove the tournament's photo (both the stored object and the URL column). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const t = await getTournament(params.id);
  if (!t) return jsonError("not found", 404);
  try {
    await removeTournamentImageObjects(params.id);
    await setTournamentImageUrl(params.id, null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleDbError(e, "Failed to remove image");
  }
}
