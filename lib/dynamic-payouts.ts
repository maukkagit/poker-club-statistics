// Dynamic (entry-scaled) payouts — pure resolution shared by the wizard preview,
// the live-manager preview and validation. The DB materializes `payout_structure`
// from these tiers via a trigger (see 0020_dynamic_payouts.sql); this module is
// the TypeScript mirror of that same math for client-side previews and checks.
import type { PayoutSlot, PayoutTier } from "@/lib/types";

/**
 * Default tier ladder (the club's standard structure). Total entries =
 * starting players + rebuys + late entries. Each tier's percentages sum to
 * 100 and imply positions 1..N.
 */
export const DEFAULT_PAYOUT_TIERS: PayoutTier[] = [
  { min_entries: 24, pcts: [50, 30, 20] },
  { min_entries: 32, pcts: [47, 27, 16, 10] },
  { min_entries: 40, pcts: [42.5, 25, 15.5, 10, 7] },
  { min_entries: 48, pcts: [37.5, 23.2, 15.2, 10.5, 7.7, 5.9] },
];

/**
 * Pick the tier that applies to `totalEntries`: the one with the greatest
 * `min_entries` at or below the count. Below the lowest threshold the lowest
 * tier is the floor. Returns null only for an empty ladder.
 */
export function selectPayoutTier(tiers: PayoutTier[], totalEntries: number): PayoutTier | null {
  if (!tiers || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.min_entries - b.min_entries);
  let picked = sorted[0]; // floor for tiny fields
  for (const tier of sorted) {
    if (tier.min_entries <= totalEntries) picked = tier;
    else break;
  }
  return picked;
}

/** Convert a tier's `pcts` into position/pct slots (positions 1..N). */
export function tierToPayoutStructure(tier: PayoutTier): PayoutSlot[] {
  return tier.pcts.map((pct, i) => ({ position: i + 1, pct }));
}

/**
 * Resolve the effective payout structure for a given entry count. Mirrors the
 * SQL `apply_dynamic_payout`. Returns [] for an empty ladder.
 */
export function resolveDynamicPayoutStructure(tiers: PayoutTier[], totalEntries: number): PayoutSlot[] {
  const tier = selectPayoutTier(tiers, totalEntries);
  return tier ? tierToPayoutStructure(tier) : [];
}

/** Sum of a tier's percentages (for validation / display). */
export function tierPctSum(tier: PayoutTier): number {
  return tier.pcts.reduce((s, p) => s + p, 0);
}

/**
 * Validate a tier ladder for the UI (mirrors SQL `_assert_payout_tiers`).
 * Returns an error string, or null when valid.
 */
export function validatePayoutTiers(tiers: PayoutTier[]): string | null {
  if (!tiers || tiers.length === 0) return "Add at least one payout tier.";
  for (const tier of tiers) {
    if (!Number.isFinite(tier.min_entries) || tier.min_entries < 1) {
      return "Each tier needs a minimum entry count of at least 1.";
    }
    if (!tier.pcts || tier.pcts.length === 0) {
      return "Each tier must pay at least one place.";
    }
    const sum = tierPctSum(tier);
    if (Math.abs(sum - 100) > 0.01) {
      return `Tier from ${tier.min_entries} entries must sum to 100% (currently ${Number(sum.toFixed(2))}%).`;
    }
  }
  return null;
}
