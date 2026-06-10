import { describe, it, expect } from "vitest";
import { buildDrawResult } from "../lib/seat-draw";

const players = [
  { player_id: "a", name: "A" },
  { player_id: "b", name: "B" },
  { player_id: "c", name: "C" },
  { player_id: "d", name: "D" },
];

// Deterministic rng + clock so the result is fully reproducible.
const rng = () => 0.42;
const now = () => "2026-01-01T00:00:00.000Z";

describe("buildDrawResult", () => {
  it("seats everyone and builds seating metadata with buttons defaulting to seat 1", () => {
    const r = buildDrawResult(
      { players, tables: 2, seatsPerTable: 5, bucketsEnabled: false, buckets: {} },
      rng,
      now,
    );
    expect(r.assignments).toHaveLength(4);
    expect(new Set(r.assignments.map(a => a.player_id))).toEqual(new Set(["a", "b", "c", "d"]));
    expect(r.seating).toMatchObject({
      tables: 2,
      seats_per_table: 5,
      buckets_used: false,
      buttons: { "1": 1, "2": 1 },
      drawn_at: "2026-01-01T00:00:00.000Z",
    });
    expect(r.bucketByPlayerId).toEqual({});
  });

  it("ignores buckets when enabled but none entered", () => {
    const r = buildDrawResult(
      { players, tables: 1, seatsPerTable: 10, bucketsEnabled: true, buckets: {} },
      rng,
      now,
    );
    expect(r.seating.buckets_used).toBe(false);
    expect(r.bucketByPlayerId).toEqual({});
  });

  it("applies buckets when enabled and at least one valid integer is present", () => {
    const r = buildDrawResult(
      {
        players,
        tables: 2,
        seatsPerTable: 5,
        bucketsEnabled: true,
        buckets: { a: 1, b: 1, c: 2, d: "" },
      },
      rng,
      now,
    );
    expect(r.seating.buckets_used).toBe(true);
    expect(r.bucketByPlayerId).toEqual({ a: 1, b: 1, c: 2 });
  });
});
