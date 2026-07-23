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
    <div className="space-y-1.5">
      {tiers.map((tier, ti) => {
        const sum = tierPctSum(tier);
        const bad = Math.abs(sum - 100) > 0.01;
        const isActive = activeTier != null && activeTier === tier;
        return (
          <div
            key={ti}
            className="relative overflow-hidden rounded-lg border pl-2.5 pr-2 py-1.5 transition-[border-color,background,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)]"
            style={{
              borderColor: isActive
                ? "color-mix(in srgb, var(--accent) 50%, var(--border))"
                : "var(--border)",
              background: isActive
                ? "color-mix(in srgb, var(--accent) 7%, var(--bg))"
                : "color-mix(in srgb, var(--card) 55%, var(--bg))",
              boxShadow: isActive
                ? "inset 3px 0 0 var(--accent)"
                : "inset 3px 0 0 transparent",
            }}
          >
            {/* Threshold + meta */}
            <div className="flex items-center gap-1.5 min-h-7">
              <span className="text-[0.65rem] uppercase tracking-[0.06em] font-semibold muted shrink-0">
                From
              </span>
              <NumberInput
                className="input !py-0.5 !px-1.5 w-[3.25rem] text-center text-sm tabular-nums font-medium shrink-0"
                value={tier.min_entries}
                onChange={n => onSetMin(ti, n ?? 0)}
                disabled={disabled}
              />
              <span className="text-xs muted truncate">
                entries
                <span className="mx-1 opacity-40">·</span>
                <span className="text-[var(--text)] font-medium tabular-nums">{tier.pcts.length}</span>
                {" "}place{tier.pcts.length === 1 ? "" : "s"}
              </span>

              <span
                className={`ml-auto text-[0.65rem] font-semibold tabular-nums shrink-0 rounded-full px-1.5 py-0.5 ${
                  bad
                    ? "neg"
                    : isActive
                      ? "pos"
                      : "muted"
                }`}
                style={{
                  background: bad
                    ? "color-mix(in srgb, var(--danger) 14%, transparent)"
                    : isActive
                      ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                      : "color-mix(in srgb, var(--text) 6%, transparent)",
                }}
                title={bad ? `Percentages sum to ${Number(sum.toFixed(2))}%, need 100%` : "Tier percentages sum"}
              >
                {Number(sum.toFixed(sum % 1 === 0 ? 0 : 2))}%
              </span>

              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveTier(ti)}
                  disabled={disabled}
                  aria-label={`Remove tier from ${tier.min_entries} entries`}
                  title="Remove tier"
                  className="muted hover:text-[var(--danger)] disabled:opacity-40 text-base leading-none w-6 h-6 rounded-md shrink-0 inline-flex items-center justify-center transition-colors"
                >
                  ×
                </button>
              )}
            </div>

            {/* Place split chips */}
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {tier.pcts.map((pct, pi) => (
                <div
                  key={pi}
                  className="group inline-flex items-center gap-0.5 rounded-md border pl-1.5 pr-0.5 py-0.5"
                  style={{
                    borderColor: "color-mix(in srgb, var(--border) 85%, transparent)",
                    background: "color-mix(in srgb, var(--bg) 70%, transparent)",
                  }}
                >
                  <span className="text-[0.6rem] font-semibold muted w-3 tabular-nums text-center shrink-0">
                    {pi + 1}
                  </span>
                  <NumberInput
                    className="input !border-0 !shadow-none !bg-transparent !rounded-none !py-0 !px-0.5 w-[2.75rem] text-sm tabular-nums text-center shrink-0"
                    allowDecimal
                    value={pct}
                    onChange={n => onSetPct(ti, pi, n ?? 0)}
                    disabled={disabled}
                  />
                  <span className="text-[0.65rem] muted shrink-0">%</span>
                  {tier.pcts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemovePlace(ti, pi)}
                      disabled={disabled}
                      aria-label={`Remove place ${pi + 1}`}
                      title={`Remove place ${pi + 1}`}
                      className="muted hover:text-[var(--danger)] disabled:opacity-40 text-xs leading-none w-4 h-4 rounded inline-flex items-center justify-center opacity-55 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity"
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
                aria-label="Add paid place"
                title="Add place"
                className="inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md border border-dashed text-xs font-medium muted hover:text-[var(--text)] hover:border-[var(--muted)] disabled:opacity-40 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAddTier}
        disabled={disabled}
        className="w-full btn-secondary text-xs py-1.5 rounded-lg border border-dashed font-medium muted hover:text-[var(--text)] disabled:opacity-40"
        style={{ borderColor: "var(--border)", background: "transparent" }}
      >
        + Add tier
      </button>
    </div>
  );
}
