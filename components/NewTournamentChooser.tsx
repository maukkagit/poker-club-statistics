"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TournamentState } from "@/lib/types";

export type NewTournamentChooserProps = {
  open: boolean;
  onChoose: (state: TournamentState) => void;
  onCancel: () => void;
};

/**
 * Modal that asks the user whether the tournament they're about to add is
 * starting *now* or has *already finished*. Picking one closes the modal
 * and dispatches `onChoose(state)` so the caller can route to the
 * appropriate form variant.
 *
 * Rendered through a portal (same pattern as ConfirmDialog) so it sits
 * above every ancestor — including the header's backdrop-blur container,
 * which would otherwise clip a position:fixed overlay.
 */
export default function NewTournamentChooser({ open, onChoose, onCancel }: NewTournamentChooserProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      aria-hidden={false}
      role="presentation"
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-tournament-title"
        className="relative w-full max-w-md rounded-xl shadow-2xl p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 id="new-tournament-title" className="text-lg font-semibold mb-1">Add a tournament</h2>
        <p className="text-sm muted mb-4">Is the tournament happening now, or has it already finished?</p>

        {/* Two equal-weight choice cards. Stacked on mobile, side-by-side
            on sm+. Each card is a button so the entire area is clickable
            and keyboard-focusable. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoiceCard
            accent="sky"
            title="Starting now"
            description="Pick the players and buy-in. Track results as the night unfolds."
            icon={<PlayIcon />}
            onClick={() => onChoose("Active")}
          />
          <ChoiceCard
            accent="emerald"
            title="Already finished"
            description="Enter the full results — buy-ins, finish positions, payouts. Standard (non-PKO) tournaments only."
            icon={<CheckIcon />}
            onClick={() => onChoose("Finished")}
          />
        </div>

        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary px-3 py-2 rounded border border-[var(--border)] text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceCard({
  accent, title, description, icon, onClick,
}: {
  accent: "sky" | "emerald";
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  // Accent colors picked to match the dashboard's existing palette
  // (sky = activity / live, emerald = money / settled).
  const accentClasses = accent === "sky"
    ? "text-sky-500 bg-sky-500/10 border-sky-500/30"
    : "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg p-4 transition-all hover:scale-[1.01] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--card)]"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
    >
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border ${accentClasses} mb-3`}>
        {icon}
      </div>
      <div className="font-semibold">{title}</div>
      <div className="text-xs muted mt-1 leading-relaxed">{description}</div>
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
