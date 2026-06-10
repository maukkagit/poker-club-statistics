import { describe, it, expect, beforeEach, vi } from "vitest";

// computePlayerStats / computeCumulativeSeries fetch their inputs internally via
// the Supabase client. We mock the client with an in-memory store so these
// remain testable today and stay pinned through the route-thinning refactor
// (#45), which will add preloaded-data overloads.

const store = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
}));

vi.mock("@/lib/supabase", () => {
  function builder(rows: any[]) {
    const b: any = {
      select: () => b,
      is: () => b,
      eq: () => b,
      order: () => b,
      then: (resolve: (v: { data: any[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return b;
  }
  return {
    supabase: () => ({
      from: (table: string) => builder(store.tables[table] ?? []),
    }),
  };
});

import { computePlayerStats, computeCumulativeSeries } from "@/lib/db";

beforeEach(() => {
  store.tables = {
    players: [
      { id: "p1", name: "Alice", created_at: "2026-01-01T00:00:00Z" },
      { id: "p2", name: "Bob", created_at: "2026-01-01T00:00:00Z" },
    ],
    tournaments: [
      {
        id: "t1",
        date: "2026-01-01",
        name: "",
        buy_in_amount: 30,
        payout_structure: [{ position: 1, pct: 100 }],
        state: "Finished",
        special: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    entries: [
      { id: "e1", tournament_id: "t1", player_id: "p1", buy_ins: 1, finish_position: 1 },
      { id: "e2", tournament_id: "t1", player_id: "p2", buy_ins: 1, finish_position: 2 },
    ],
  };
});

describe("computePlayerStats", () => {
  it("aggregates per-player cost/winnings/net and sorts by net desc", async () => {
    const stats = await computePlayerStats();
    // pool = 2*30 = 60 -> winner takes 60
    expect(stats.map(s => ({ id: s.player_id, net: s.net_profit, itm: s.itm_count }))).toEqual([
      { id: "p1", net: 30, itm: 1 },
      { id: "p2", net: -30, itm: 0 },
    ]);
    const alice = stats[0];
    expect(alice.tournaments).toBe(1);
    expect(alice.total_cost).toBe(30);
    expect(alice.total_winnings).toBe(60);
    expect(alice.avg_net).toBe(30);
  });
});

describe("computeCumulativeSeries", () => {
  it("produces one running-total point per tournament in date order", async () => {
    const { players, points, latestTournamentPlayerIds } = await computeCumulativeSeries();
    expect(players.map(p => p.id)).toEqual(["p1", "p2"]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ date: "2026-01-01", tournamentId: "t1", p1: 30, p2: -30 });
    expect(latestTournamentPlayerIds.sort()).toEqual(["p1", "p2"]);
  });
});
