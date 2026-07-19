import { describe, it, expect } from "vitest";
import { computeEntries, computeTournamentSummary } from "@/lib/db";
import { makePlayer, makeTournament, makeEntry } from "./fixtures";

// Characterization tests pinning the current behavior of the pure stats math
// BEFORE the lib/db split (#36) and the route-thinning refactor (#45). These
// must keep passing byte-for-byte through those refactors.

describe("computeEntries", () => {
  const t = makeTournament({
    id: "t1",
    buy_in_amount: 30,
    payout_structure: [
      { position: 1, pct: 70 },
      { position: 2, pct: 30 },
    ],
  });

  it("splits the pool by payout structure and computes net", () => {
    const entries = [
      makeEntry({ id: "e1", tournament_id: "t1", player_id: "p1", buy_ins: 1, finish_position: 1 }),
      makeEntry({ id: "e2", tournament_id: "t1", player_id: "p2", buy_ins: 2, finish_position: 2 }),
      makeEntry({ id: "e3", tournament_id: "t1", player_id: "p3", buy_ins: 1, finish_position: null }),
    ];
    // pool = (1+2+1)*30 = 120 -> pos1 = 84, pos2 = 36
    const out = computeEntries(t, entries);
    expect(out.map(c => ({ id: c.id, payout: c.payout, cost: c.cost, net: c.net }))).toEqual([
      { id: "e1", payout: 84, cost: 30, net: 54 },
      { id: "e2", payout: 36, cost: 60, net: -24 },
      { id: "e3", payout: 0, cost: 30, net: -30 },
    ]);
  });

  it("counts add-ons into the pool and each buyer's cost (regular pool only)", () => {
    const addonT = makeTournament({
      id: "t-addons",
      buy_in_amount: 30,
      addons_allowed: true,
      addon_price: 20,
      payout_structure: [{ position: 1, pct: 100 }],
    });
    const entries = [
      makeEntry({ id: "e1", tournament_id: "t-addons", player_id: "p1", buy_ins: 1, addons: 1, finish_position: 1 }),
      makeEntry({ id: "e2", tournament_id: "t-addons", player_id: "p2", buy_ins: 1, addons: 0, finish_position: null }),
    ];
    // pool = (1+1)*30 + (1+0)*20 = 80 -> pos1 = 80
    const out = computeEntries(addonT, entries);
    expect(out.map(c => ({ id: c.id, payout: c.payout, cost: c.cost, net: c.net }))).toEqual([
      { id: "e1", payout: 80, cost: 50, net: 30 }, // paid 30 buy-in + 20 add-on
      { id: "e2", payout: 0, cost: 30, net: -30 },
    ]);
  });

  it("lets a per-entry payout_override win over the structure", () => {
    const entries = [
      makeEntry({ id: "e1", tournament_id: "t1", player_id: "p1", buy_ins: 1, finish_position: 1, payout_override: 100 }),
    ];
    const [c] = computeEntries(t, entries);
    expect(c.payout).toBe(100);
    expect(c.net).toBe(70); // 100 - 30
  });

  it("applies a deal (payout_overrides by position) over the percentage split", () => {
    const dealt = makeTournament({
      id: "t2",
      buy_in_amount: 30,
      payout_structure: [
        { position: 1, pct: 70 },
        { position: 2, pct: 30 },
      ],
      payout_overrides: { "1": 90, "2": 30 },
    });
    const entries = [
      makeEntry({ id: "e1", tournament_id: "t2", player_id: "p1", buy_ins: 1, finish_position: 1 }),
      makeEntry({ id: "e2", tournament_id: "t2", player_id: "p2", buy_ins: 1, finish_position: 2 }),
    ];
    const out = computeEntries(dealt, entries);
    expect(out.map(c => c.payout)).toEqual([90, 30]);
  });
});

describe("computeTournamentSummary", () => {
  const players = [makePlayer("p1", "Alice"), makePlayer("p2", "Bob"), makePlayer("p3", "Cara")];
  const t1 = makeTournament({ id: "t1", date: "2026-01-01", buy_in_amount: 30, payout_structure: [{ position: 1, pct: 100 }] });
  const t2 = makeTournament({ id: "t2", date: "2026-02-01", buy_in_amount: 50, payout_structure: [{ position: 1, pct: 60 }, { position: 2, pct: 40 }] });
  const entries = [
    // t1: pool = 3*30 = 90, win = 90
    makeEntry({ id: "e1", tournament_id: "t1", player_id: "p1", buy_ins: 1, finish_position: 1 }),
    makeEntry({ id: "e2", tournament_id: "t1", player_id: "p2", buy_ins: 1, finish_position: 2 }),
    makeEntry({ id: "e3", tournament_id: "t1", player_id: "p3", buy_ins: 1, finish_position: 3 }),
    // t2: pool = 4*50 = 200, win = 120
    makeEntry({ id: "e4", tournament_id: "t2", player_id: "p1", buy_ins: 2, finish_position: 1 }),
    makeEntry({ id: "e5", tournament_id: "t2", player_id: "p2", buy_ins: 2, finish_position: 2 }),
  ];

  it("aggregates pool/field/buy-in metrics across finished tournaments", () => {
    const s = computeTournamentSummary([t1, t2], entries, players);
    expect(s.total_tournaments).toBe(2);
    expect(s.total_prize_pool).toBe(290);
    expect(s.avg_buy_in).toBe(40); // (30+50)/2
    expect(s.avg_prize_pool).toBe(145); // 290/2
    expect(s.avg_player_count).toBe(2.5); // (3+2)/2
    expect(s.avg_win_amount).toBe(105); // (90+120)/2
    expect(s.biggest_pool).toEqual({ amount: 200, date: "2026-02-01", name: "" });
    expect(s.biggest_field).toEqual({ count: 3, date: "2026-01-01", name: "" });
    expect(s.biggest_win?.amount).toBe(120);
    expect(s.biggest_win?.player_name).toBe("Alice");
    expect(s.most_buy_ins?.count).toBe(2);
  });

  it("excludes Active tournaments and (by default) special tournaments", () => {
    const active = makeTournament({ id: "t3", state: "Active" });
    const special = makeTournament({ id: "t4", special: true });
    const s = computeTournamentSummary([t1, t2, active, special], entries, players);
    expect(s.total_tournaments).toBe(2);

    const withSpecial = computeTournamentSummary([t1, t2, special], entries, players, { includeSpecial: true });
    expect(withSpecial.total_tournaments).toBe(3);
  });

  it("folds add-on money into the prize pool total", () => {
    const t3 = makeTournament({
      id: "t3", date: "2026-03-01", buy_in_amount: 30, addon_price: 20,
      payout_structure: [{ position: 1, pct: 100 }],
    });
    const withAddon = [
      makeEntry({ id: "e6", tournament_id: "t3", player_id: "p1", buy_ins: 1, addons: 1, finish_position: 1 }),
      makeEntry({ id: "e7", tournament_id: "t3", player_id: "p2", buy_ins: 1, finish_position: 2 }),
    ];
    const s = computeTournamentSummary([t3], withAddon, players);
    // pool = 2*30 + 1*20 = 80
    expect(s.total_prize_pool).toBe(80);
  });

  it("returns the empty summary when nothing qualifies", () => {
    const s = computeTournamentSummary([], [], players);
    expect(s.total_tournaments).toBe(0);
    expect(s.biggest_pool).toBeNull();
  });
});
