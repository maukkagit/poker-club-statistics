// Supabase Storage helpers for the single per-tournament photo.
//
// Objects live in the public `tournament-images` bucket under a per-tournament
// folder (`<tournament-id>/<timestamp>.<ext>`). We enforce "max one photo" by
// clearing the folder before every upload, so a replacement never leaves the
// previous file behind. All calls use the server-side service-role client, so
// they bypass Storage RLS; the bucket is public-read for the feed/summary.
import { supabase } from "@/lib/supabase";

const BUCKET = "tournament-images";

/**
 * Remove every stored object for a tournament. Safe to call when the folder
 * doesn't exist yet (list simply returns nothing).
 */
export async function removeTournamentImageObjects(id: string): Promise<void> {
  const sb = supabase();
  const { data, error } = await sb.storage.from(BUCKET).list(id);
  if (error) throw new Error(error.message);
  const paths = (data ?? []).map(f => `${id}/${f.name}`);
  if (paths.length) {
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
    if (rmErr) throw new Error(rmErr.message);
  }
}

/**
 * Upload (replacing any existing) a tournament photo and return its public URL.
 * The timestamped path doubles as a cache-buster so a replaced photo shows up
 * immediately instead of being served stale from the CDN.
 */
export async function uploadTournamentImage(
  id: string, bytes: ArrayBuffer, contentType: string, ext: string,
): Promise<string> {
  const sb = supabase();
  await removeTournamentImageObjects(id);
  const path = `${id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
