"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import TournamentImageField from "@/components/TournamentImageField";

/**
 * Photo step of the Finish-tournament flow. Prompts the director to snap or
 * upload a photo before the night is closed out. When a photo already exists it
 * frames the choice as keep-or-retake (the embedded field offers Replace /
 * Remove); otherwise it's a plain add-or-skip. "Continue" always proceeds to
 * the rest of the finish flow — the photo is optional.
 *
 * Structured like ConfirmDialog (portal to body, Esc / backdrop close, scroll
 * lock) so it feels identical to the other live-manager dialogs.
 */
export default function FinishPhotoDialog({
  open,
  tournamentId,
  imageUrl,
  busy = false,
  onContinue,
  onCancel,
}: {
  open: boolean;
  tournamentId: string;
  imageUrl: string | null | undefined;
  busy?: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onCancel]);

  if (!mounted) return null;

  const hasPhoto = !!imageUrl;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4 transition-opacity duration-150 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      aria-hidden={!open}
      role="presentation"
    >
      <div
        className={open ? "absolute inset-0 animate-backdrop-in" : "absolute inset-0"}
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-photo-title"
        className={`relative w-full sm:max-w-md rounded-t-2xl sm:rounded-xl shadow-2xl p-5 ${open ? "animate-dialog-in sheet-on-mobile" : ""}`}
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 id="finish-photo-title" className="text-lg font-semibold mb-2">
          {hasPhoto ? "Keep or retake the photo?" : "Add a photo?"}
        </h2>
        <p className="text-sm muted mb-4">
          {hasPhoto
            ? "This tournament already has a photo. Keep it, or replace it with a new one before finishing."
            : "Take or upload a photo to remember the night by. It appears in the home feed. You can skip this."}
        </p>
        <TournamentImageField tournamentId={tournamentId} imageUrl={imageUrl} disabled={busy} />
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary px-3 py-2 rounded border border-[var(--border)] text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="btn px-3 py-2 rounded font-semibold text-sm"
          >
            {hasPhoto ? "Keep & continue" : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
