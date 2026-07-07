"use client";
import { useRef, useState } from "react";
import { uploadTournamentImage, removeTournamentImage } from "@/lib/api";

/**
 * Add / replace / remove the single photo attached to a tournament.
 *
 * Uploads go straight to the dedicated image endpoint (which writes to Storage
 * and stamps the `image_url` column), then the shared cache-invalidation kicks
 * in so the parent re-renders with the fresh `imageUrl`. The hidden file input
 * carries `capture="environment"` so mobile browsers offer the rear camera for
 * a quick on-the-spot photo, while still allowing a library pick.
 *
 * Used from the live manager's Basic info tab, the Finish-tournament prompt and
 * the finished-tournament editor — every surface where a photo can be managed.
 */
export default function TournamentImageField({
  tournamentId,
  imageUrl,
  disabled = false,
  onChanged,
}: {
  tournamentId: string;
  imageUrl: string | null | undefined;
  disabled?: boolean;
  /** Optional hook fired after a successful upload/remove (e.g. to re-mutate). */
  onChanged?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(file: File | null) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) { setErr("Please choose an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("Image is too large (max 10 MB)."); return; }
    setBusy(true);
    try {
      await uploadTournamentImage(tournamentId, file);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onRemove() {
    setErr(null);
    setBusy(true);
    try {
      await removeTournamentImage(tournamentId);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  const isDisabled = disabled || busy;

  return (
    <div className="space-y-2">
      {/* No `capture` attribute: on mobile the OS then offers both the camera
          and the existing photo library, instead of jumping straight to the
          camera. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => onPick(e.target.files?.[0] ?? null)}
      />
      {imageUrl ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Tournament photo"
            className="aspect-square w-full max-w-[16rem] rounded-lg object-cover border border-[var(--border)]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={isDisabled}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "Working…" : "Replace photo"}
            </button>
            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={isDisabled}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex aspect-square w-full max-w-[16rem] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-4 text-center text-[var(--muted)] transition-colors hover:border-accent/60 hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isDisabled}
          onClick={() => inputRef.current?.click()}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="m21 16-4.5-4.5L7 21" />
          </svg>
          <span className="text-sm font-medium">{busy ? "Uploading…" : "Add photo"}</span>
          <span className="text-xs leading-snug">Take a photo or pick from your gallery</span>
        </button>
      )}
      {err && <p className="neg text-sm">{err}</p>}
    </div>
  );
}
