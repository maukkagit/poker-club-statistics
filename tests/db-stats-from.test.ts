import { describe, it, expect } from "vitest";
import { computePlayerStatsFrom, computeCumulativeSeriesFrom } from "@/lib/db";
import { makePlayer, makeTournament, makeEntry } from "./fixtures";

// The pure preloaded-data cores added by the route-thinning refactor (#45).
// /api/stats and /api/players/[id] now fetch the raw tables once and feed them
// here, instead of each compute* helper re-fetching. These pin that the cores
// produce the same aggregates the async wrappers used to.

const players = [makePlayer("p1", "Alice"), makePlayer("p2", "Bob")];
const tournaments = [
  makeTournament({ id: "t1", date: "2026-01-01", buy_in_amount: 30, payout_structure: [{ position: 1, pct: 100 }] }),
  makeTournament({ id: "t2", date: "2026-02-01", buy_in_amount: 30, payout_structure: [{ position: 1, pct: 100 }], special: true }),
];
const entries = [
  makeEntry({ id: "e1", tournament_id: "t1", player_id: "p1", buy_ins: 1, finish_position: 1 }),
  makeEntry({ id: "e2", tournament_id: "t1", player_id: "p2", buy_ins: 1, finish_position: 2 }),
  makeEntry({ id: "e3", tournament_id: "t2", player_id: "p1", buy_ins: 1, finish_position: 2 }),
  makeEntry({ id: "e4", tournament_id: "t2", player_id: "p2", buy_ins: 1, finish_position: 1 }),
];

describe("computePlayerStatsFrom", () => {
  it("excludes special tournaments by default", () => {
    const stats = computePlayerStatsFrom(players, tournaments, entries);
    expect(stats.map(s => ({ id: s.player_id, net: s.net_profit, t: s.tournaments }))).toEqual([
      { id: "p1", net: 30, t: 1 },
      { id: "p2", net: -30, t: 1 },
    ]);
  });

  it("includes special tournaments when the filter is set", () => {
    const stats = computePlayerStatsFrom(players, tournaments, entries, { includeSpecial: true });
    // Both win once, lose once: nets cancel to 0 over the two events.
    expect(stats.every(s => s.tournaments === 2 && s.net_profit === 0)).toBe(true);
  });
});

describe("computeCumulativeSeriesFrom", () => {
  it("emits one running-total point per included tournament in date order", () => {
    const { points, latestTournamentPlayerIds } = computeCumulativeSeriesFrom(
      players, tournaments, entries, { includeSpecial: true },
    );
    expect(points.map(p => p.tournamentId)).toEqual(["t1", "t2"]);
    expect(points[0]).toMatchObject({ p1: 30, p2: -30 });
    expect(points[1]).toMatchObject({ p1: 0, p2: 0 });
    expect(latestTournamentPlayerIds.sort()).toEqual(["p1", "p2"]);
  });
});
