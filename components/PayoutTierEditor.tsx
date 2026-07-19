"use client";
import type { PayoutTier } from "@/lib/types";
import NumberInput from "@/components/NumberInput";
import { selectPayoutTier, tierPctSum } from "@/lib/dynamic-payouts";

/**
 * Controlled editor for a dynamic-payout tier ladder. Each tier is keyed by a
 * minimum entry count and lists the percentage paid to positions 1..N. Shared
 * by the start wizard and the live-manager settings. Purely presentational —
 * all mutations flow back through the callbacks so the parent owns the state
 * and the save.
 */
export default function PayoutTierEditor({
  tiers,
  onSetMin,
  onSetPct,
  onAddPlace,
  onRemovePlace,
  onAddTier,
  onRemoveTier,
  previewEntries,
  disabled = false,
}: {
  tiers: PayoutTier[];
  onSetMin: (tierIdx: number, min: number) => void;
  onSetPct: (tierIdx: number, placeIdx: number, pct: number) => void;
  onAddPlace: (tierIdx: number) => void;
  onRemovePlace: (tierIdx: number, placeIdx: number) => void;
  onAddTier: () => void;
  onRemoveTier: (tierIdx: number) => void;
  // When provided, highlights which tier currently applies to that field size.
  previewEntries?: number;
  disabled?: boolean;
}) {
  const activeTier = previewEntries != null ? selectPayoutTier(tiers, previewEntries) : null;

  return (
    <div className="space-y-3">
      {tiers.map((tier, ti) => {
        const sum = tierPctSum(tier);
        const bad = Math.abs(sum - 100) > 0.01;
        const isActive = activeTier != null && activeTier === tier;
        return (
          <div
            key={ti}
            className="rounded-lg border p-3"
            style={{
              borderColor: isActive ? "rgb(34 197 94)" : "var(--border)",
              background: "var(--bg)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-sm font-medium">From</span>
              <NumberInput
                className="input w-16 sm:w-20 shrink-0"
                value={tier.min_entries}
                onChange={n => onSetMin(ti, n ?? 0)}
                disabled={disabled}
              />
              <span className="text-sm muted">entries → pays {tier.pcts.length} place{tier.pcts.length === 1 ? "" : "s"}</span>
              <span className={`text-sm ml-auto ${bad ? "neg" : "muted"}`}>Sum: {Number(sum.toFixed(2))}%</span>
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveTier(ti)}
                  disabled={disabled}
                  className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)] shrink-0"
                >
                  Remove tier
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {tier.pcts.map((pct, pi) => (
                <div key={pi} className="flex items-center gap-1">
                  <span className="muted text-xs w-6 text-right">{pi + 1}.</span>
                  <NumberInput
                    className="input w-16 shrink-0"
                    allowDecimal
                    value={pct}
                    onChange={n => onSetPct(ti, pi, n ?? 0)}
                    disabled={disabled}
                  />
                  <span className="muted text-xs">%</span>
                  {tier.pcts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemovePlace(ti, pi)}
                      disabled={disabled}
                      aria-label={`Remove place ${pi + 1}`}
                      className="muted hover:text-[var(--neg)] text-sm px-1"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => onAddPlace(ti)}
                disabled={disabled}
                className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
              >
                + Place
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAddTier}
        disabled={disabled}
        className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
      >
        + Add tier
      </button>

      {previewEntries != null && activeTier && (
        <p className="muted text-xs leading-snug">
          With {previewEntries} {previewEntries === 1 ? "entry" : "entries"} so far → paying{" "}
          {activeTier.pcts.length} place{activeTier.pcts.length === 1 ? "" : "s"} (
          {activeTier.pcts.map(p => `${Number(p.toFixed(2))}%`).join(" / ")}).
          {previewEntries < activeTier.min_entries
            ? " Uses the lowest tier as the floor until the field grows."
            : " More entries move up to the next tier automatically."}
        </p>
      )}
    </div>
  );
}
