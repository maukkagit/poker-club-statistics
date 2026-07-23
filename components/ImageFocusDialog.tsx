"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  imageObjectPosition,
  normalizeFocus,
  type ImageFocus,
} from "@/lib/image-focus";

/**
 * Modal for picking the focal point of a tournament photo (typically a face).
 *
 * The director taps/drags on the full image; a crosshair marks the point. A
 * live crop preview mirrors how the home feed will cover-crop the photo so the
 * choice is obvious before saving. Used both when uploading a new file and when
 * adjusting focus on an existing photo.
 */
export default function ImageFocusDialog({
  open,
  src,
  initialFocus,
  busy = false,
  confirmLabel = "Save",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  src: string;
  initialFocus?: ImageFocus | null;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: (focus: ImageFocus) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [focus, setFocus] = useState<ImageFocus>(() =>
    normalizeFocus(initialFocus?.x, initialFocus?.y),
  );
  const dragging = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Reset the marker whenever a new image / dialog open cycle starts.
  useEffect(() => {
    if (!open) return;
    setFocus(normalizeFocus(initialFocus?.x, initialFocus?.y));
  }, [open, src, initialFocus?.x, initialFocus?.y]);

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

  const setFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setFocus({
      x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    });
  }, []);

  if (!mounted) return null;

  const position = imageObjectPosition(focus.x, focus.y);

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
        aria-labelledby="image-focus-title"
        className={`relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl shadow-2xl p-5 max-h-[92vh] overflow-y-auto ${open ? "animate-dialog-in sheet-on-mobile" : ""}`}
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 id="image-focus-title" className="text-lg font-semibold mb-1">
          Choose the focus point
        </h2>
        <p className="text-sm muted mb-4">
          Tap the person&apos;s face (or the most important part of the photo).
          The feed will keep that spot in frame when it crops.
        </p>

        {/* Full image stage — sized to the photo so % coords map 1:1. */}
        <div className="flex justify-center mb-4">
          <div
            ref={stageRef}
            className="relative inline-block max-w-full touch-none select-none cursor-crosshair rounded-lg overflow-hidden border border-[var(--border)]"
            onPointerDown={e => {
              if (busy) return;
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromPointer(e.clientX, e.clientY);
            }}
            onPointerMove={e => {
              if (!dragging.current || busy) return;
              setFromPointer(e.clientX, e.clientY);
            }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Choose focus point"
              draggable={false}
              className="block max-h-[min(50vh,28rem)] max-w-full w-auto h-auto"
            />
            {/* Crosshair marker */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute z-10"
              style={{
                left: `${focus.x}%`,
                top: `${focus.y}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <span
                className="relative flex h-9 w-9 items-center justify-center"
              >
                <span
                  className="absolute inset-0 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                  style={{ background: "color-mix(in srgb, var(--accent) 28%, transparent)" }}
                />
                <span className="absolute h-px w-5 bg-white/90" />
                <span className="absolute w-px h-5 bg-white/90" />
              </span>
            </span>
          </div>
        </div>

        {/* Live crop preview — mirrors the feed's cover crop. */}
        <div className="mb-5">
          <p className="text-[0.7rem] uppercase tracking-[0.08em] font-semibold muted mb-1.5">
            Feed preview
          </p>
          <div
            className="relative w-full overflow-hidden rounded-lg border border-[var(--border)]"
            style={{ aspectRatio: "16 / 10", background: "var(--bg)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: position }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
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
            onClick={() => onConfirm(focus)}
            disabled={busy}
            className="btn px-3 py-2 rounded font-semibold text-sm"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
