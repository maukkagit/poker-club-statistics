import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAYOUT_TIERS,
  selectPayoutTier,
  tierToPayoutStructure,
  resolveDynamicPayoutStructure,
  tierPctSum,
  validatePayoutTiers,
} from "@/lib/dynamic-payouts";
import type { PayoutTier } from "@/lib/types";

const tiers: PayoutTier[] = [
  { min_entries: 10, pcts: [60, 40] },
  { min_entries: 20, pcts: [50, 30, 20] },
  { min_entries: 40, pcts: [45, 25, 18, 12] },
];

describe("selectPayoutTier", () => {
  it("returns null for an empty ladder", () => {
    expect(selectPayoutTier([], 50)).toBeNull();
  });

  it("uses the lowest tier as the floor below the smallest threshold", () => {
    expect(selectPayoutTier(tiers, 0)).toEqual(tiers[0]);
    expect(selectPayoutTier(tiers, 9)).toEqual(tiers[0]);
  });

  it("picks the greatest tier at or below the entry count", () => {
    expect(selectPayoutTier(tiers, 10)).toEqual(tiers[0]);
    expect(selectPayoutTier(tiers, 19)).toEqual(tiers[0]);
    expect(selectPayoutTier(tiers, 20)).toEqual(tiers[1]);
    expect(selectPayoutTier(tiers, 39)).toEqual(tiers[1]);
    expect(selectPayoutTier(tiers, 40)).toEqual(tiers[2]);
    expect(selectPayoutTier(tiers, 1000)).toEqual(tiers[2]);
  });

  it("is order-independent (sorts by threshold)", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(selectPayoutTier(shuffled, 25)).toEqual(tiers[1]);
  });
});

describe("tierToPayoutStructure", () => {
  it("maps pcts to positions 1..N", () => {
    expect(tierToPayoutStructure({ min_entries: 5, pcts: [70, 30] })).toEqual([
      { position: 1, pct: 70 },
      { position: 2, pct: 30 },
    ]);
  });
});

describe("resolveDynamicPayoutStructure", () => {
  it("returns [] for an empty ladder", () => {
    expect(resolveDynamicPayoutStructure([], 30)).toEqual([]);
  });

  it("resolves the applicable tier into a position/pct structure", () => {
    expect(resolveDynamicPayoutStructure(tiers, 25)).toEqual([
      { position: 1, pct: 50 },
      { position: 2, pct: 30 },
      { position: 3, pct: 20 },
    ]);
  });

  it("scales up the number of paid places as the field grows", () => {
    expect(resolveDynamicPayoutStructure(tiers, 12).length).toBe(2);
    expect(resolveDynamicPayoutStructure(tiers, 30).length).toBe(3);
    expect(resolveDynamicPayoutStructure(tiers, 60).length).toBe(4);
  });
});

describe("tierPctSum", () => {
  it("sums the percentages", () => {
    expect(tierPctSum({ min_entries: 10, pcts: [50, 30, 20] })).toBe(100);
    expect(tierPctSum({ min_entries: 10, pcts: [42.5, 25, 15.5, 10, 7] })).toBeCloseTo(100, 5);
  });
});

describe("validatePayoutTiers", () => {
  it("accepts the default ladder", () => {
    expect(validatePayoutTiers(DEFAULT_PAYOUT_TIERS)).toBeNull();
  });

  it("accepts a valid custom ladder", () => {
    expect(validatePayoutTiers(tiers)).toBeNull();
  });

  it("rejects an empty ladder", () => {
    expect(validatePayoutTiers([])).toMatch(/at least one payout tier/i);
  });

  it("rejects a tier with a non-positive minimum", () => {
    expect(validatePayoutTiers([{ min_entries: 0, pcts: [100] }])).toMatch(/minimum entry count/i);
  });

  it("rejects a tier with no paid places", () => {
    expect(validatePayoutTiers([{ min_entries: 10, pcts: [] }])).toMatch(/at least one place/i);
  });

  it("rejects a tier whose percentages don't sum to 100", () => {
    expect(validatePayoutTiers([{ min_entries: 10, pcts: [60, 30] }])).toMatch(/sum to 100%/i);
  });

  it("tolerates rounding within 0.01", () => {
    expect(validatePayoutTiers([{ min_entries: 10, pcts: [33.33, 33.33, 33.34] }])).toBeNull();
  });

  it("every default tier sums to 100", () => {
    for (const tier of DEFAULT_PAYOUT_TIERS) {
      expect(tierPctSum(tier)).toBeCloseTo(100, 5);
    }
  });
});
