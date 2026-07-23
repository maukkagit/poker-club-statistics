import { describe, expect, it } from "vitest";
import { buildManualDrawResult } from "@/lib/seat-draw";

describe("buildManualDrawResult", () => {
  const players = [
    { player_id: "p1", name: "Ada" },
    { player_id: "p2", name: "Bea" },
  ];

  it("stamps seating metadata and keeps placements", () => {
    const r = buildManualDrawResult({
      players,
      tables: 1,
      seatsPerTable: 6,
      assignments: [
        { player_id: "p1", table_no: 1, seat_no: 3 },
        { player_id: "p2", table_no: 1, seat_no: 1 },
      ],
      now: () => "2026-07-23T12:00:00.000Z",
    });
    expect(r.seating).toEqual({
      tables: 1,
      seats_per_table: 6,
      buckets_used: false,
      buttons: { "1": 1 },
      drawn_at: "2026-07-23T12:00:00.000Z",
    });
    expect(r.assignments).toEqual([
      { player_id: "p1", table_no: 1, seat_no: 3 },
      { player_id: "p2", table_no: 1, seat_no: 1 },
    ]);
    expect(r.bucketByPlayerId).toEqual({});
  });

  it("drops assignments for unknown players", () => {
    const r = buildManualDrawResult({
      players,
      tables: 1,
      seatsPerTable: 4,
      assignments: [
        { player_id: "p1", table_no: 1, seat_no: 1 },
        { player_id: "ghost", table_no: 1, seat_no: 2 },
      ],
    });
    expect(r.assignments).toEqual([{ player_id: "p1", table_no: 1, seat_no: 1 }]);
  });
});
