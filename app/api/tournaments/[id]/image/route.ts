import { NextResponse } from "next/server";
import { getTournament, setTournamentImageUrl } from "@/lib/db";
import { uploadTournamentImage, removeTournamentImageObjects } from "@/lib/db/tournament-images";
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

/** Upload (or replace) the tournament's single photo. Body: multipart `file`. */
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

    const ext = EXT_BY_TYPE[type] ?? "jpg";
    const bytes = await file.arrayBuffer();
    const url = await uploadTournamentImage(params.id, bytes, type, ext);
    await setTournamentImageUrl(params.id, url);
    return NextResponse.json({ image_url: url });
  } catch (e) {
    return handleDbError(e, "Failed to upload image");
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
