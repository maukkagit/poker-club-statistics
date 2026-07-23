"use client";
import { useEffect, useRef, useState } from "react";
import {
  uploadTournamentImage,
  updateTournamentImageFocus,
  removeTournamentImage,
} from "@/lib/api";
import { imageObjectPosition, normalizeFocus, type ImageFocus } from "@/lib/image-focus";
import ImageFocusDialog from "@/components/ImageFocusDialog";

/**
 * Add / replace / remove the single photo attached to a tournament.
 *
 * Picking a file (or adjusting an existing photo) opens a focal-point dialog
 * so the director can mark a face before the upload/PATCH is sent. Uploads go
 * to the dedicated image endpoint (Storage + `image_url` / focus columns), then
 * shared cache-invalidation refreshes the parent. The hidden file input lets
 * mobile offer both camera and library.
 *
 * Used from the live manager's Basic info tab, the Finish-tournament prompt and
 * the finished-tournament editor — every surface where a photo can be managed.
 */
export default function TournamentImageField({
  tournamentId,
  imageUrl,
  focusX,
  focusY,
  disabled = false,
  onChanged,
}: {
  tournamentId: string;
  imageUrl: string | null | undefined;
  focusX?: number | null;
  focusY?: number | null;
  disabled?: boolean;
  /** Optional hook fired after a successful upload/remove (e.g. to re-mutate). */
  onChanged?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pending local file awaiting focus confirmation before upload.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  // Adjust-focus mode for an already-uploaded photo.
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Revoke blob URLs we create for the pending preview.
  useEffect(() => {
    return () => {
      if (pendingSrc?.startsWith("blob:")) URL.revokeObjectURL(pendingSrc);
    };
  }, [pendingSrc]);

  function clearPending() {
    if (pendingSrc?.startsWith("blob:")) URL.revokeObjectURL(pendingSrc);
    setPendingFile(null);
    setPendingSrc(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPick(file: File | null) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) { setErr("Please choose an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setErr("Image is too large (max 10 MB)."); return; }
    if (pendingSrc?.startsWith("blob:")) URL.revokeObjectURL(pendingSrc);
    setPendingFile(file);
    setPendingSrc(URL.createObjectURL(file));
  }

  async function onConfirmUpload(focus: ImageFocus) {
    if (!pendingFile) return;
    setBusy(true);
    setErr(null);
    try {
      await uploadTournamentImage(tournamentId, pendingFile, focus);
      clearPending();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmAdjust(focus: ImageFocus) {
    setBusy(true);
    setErr(null);
    try {
      await updateTournamentImageFocus(tournamentId, focus);
      setAdjustOpen(false);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update focus point");
    } finally {
      setBusy(false);
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
  const savedFocus = normalizeFocus(focusX, focusY);
  const previewPosition = imageObjectPosition(focusX, focusY);

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
            style={{ objectPosition: previewPosition }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={isDisabled}
              onClick={() => setAdjustOpen(true)}
            >
              Adjust focus
            </button>
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

      <ImageFocusDialog
        open={!!pendingSrc}
        src={pendingSrc ?? ""}
        initialFocus={null}
        busy={busy}
        confirmLabel="Upload photo"
        onConfirm={onConfirmUpload}
        onCancel={clearPending}
      />

      <ImageFocusDialog
        open={adjustOpen && !!imageUrl}
        src={imageUrl ?? ""}
        initialFocus={savedFocus}
        busy={busy}
        confirmLabel="Save focus"
        onConfirm={onConfirmAdjust}
        onCancel={() => setAdjustOpen(false)}
      />
    </div>
  );
}
