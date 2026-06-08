"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  // When true, only the primary "confirm" button is shown — useful for
  // info / error dialogs where there's nothing to cancel. Esc / backdrop
  // click still close the dialog through `onCancel`.
  hideCancel?: boolean;
};

/**
 * Simple, accessible confirmation modal.
 *
 * Rendered through a portal to document.body so it isn't clipped by any
 * ancestor that creates a new containing block (the header uses
 * `backdrop-blur`, which would otherwise trap a `position: fixed` overlay
 * inside its bounds — same gotcha that bit the mobile drawer).
 *
 * Behaviour notes:
 *   - Esc closes; clicking the backdrop closes (both invoke `onCancel`).
 *   - Body scroll is locked while open.
 *   - When `busy` is true, both buttons are disabled so a double-click
 *     can't fire the action twice while the request is in flight.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  hideCancel = false,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 transition-opacity duration-150 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      aria-hidden={!open}
      role="presentation"
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-sm rounded-xl shadow-2xl p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 id="confirm-title" className="text-lg font-bold mb-2">{title}</h2>
        <div className="text-sm muted mb-5">{message}</div>
        <div className="flex justify-end gap-2">
          {!hideCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="btn-secondary px-3 py-2 rounded border border-[var(--border)] text-sm"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => { void onConfirm(); }}
            disabled={busy}
            className={`${destructive ? "btn-danger" : "btn"} px-3 py-2 rounded font-semibold text-sm`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
