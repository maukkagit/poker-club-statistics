import { describe, it, expect } from "vitest";
import { computeNetPositions, simplifyDebts, type SettlementPlayer } from "@/lib/settlement";

function totalsBalance(players: SettlementPlayer[], perEntryCost: number) {
  const positions = computeNetPositions(players, perEntryCost);
  const sum = positions.reduce((s, p) => s + p.net, 0);
  return { positions, sum };
}

describe("computeNetPositions", () => {
  it("nets winnings against buy-ins; balances sum to zero", () => {
    // 3 players, €30 buy-in, winner takes the whole €90 pool.
    const players: SettlementPlayer[] = [
      { player_id: "a", name: "A", buyIns: 1, prizeWon: 90, bountyWon: 0 },
      { player_id: "b", name: "B", buyIns: 1, prizeWon: 0, bountyWon: 0 },
      { player_id: "c", name: "C", buyIns: 1, prizeWon: 0, bountyWon: 0 },
    ];
    const { positions, sum } = totalsBalance(players, 30);
    expect(sum).toBe(0);
    expect(positions.find(p => p.player_id === "a")!.net).toBe(60); // won 90, paid 30
    expect(positions.find(p => p.player_id === "b")!.net).toBe(-30);
    expect(positions.find(p => p.player_id === "c")!.net).toBe(-30);
  });

  it("counts re-entries as extra buy-ins of the full per-entry cost", () => {
    const players: SettlementPlayer[] = [
      { player_id: "a", name: "A", buyIns: 2, prizeWon: 0, bountyWon: 0 },
    ];
    const [pos] = computeNetPositions(players, 30);
    expect(pos.paid).toBe(60);
    expect(pos.net).toBe(-60);
  });

  it("PKO: per-entry cost includes the bounty and bounty cash is winnings; sums to zero", () => {
    // €30 entry = €15 pool + €15 bounty. 3 players. Pool €45, bounties €45.
    // A wins the pool (45) and cashed €30 of bounties; B cashed €15 bounty.
    const players: SettlementPlayer[] = [
      { player_id: "a", name: "A", buyIns: 1, prizeWon: 45, bountyWon: 30 },
      { player_id: "b", name: "B", buyIns: 1, prizeWon: 0, bountyWon: 15 },
      { player_id: "c", name: "C", buyIns: 1, prizeWon: 0, bountyWon: 0 },
    ];
    const { positions, sum } = totalsBalance(players, 30);
    expect(sum).toBe(0);
    expect(positions.find(p => p.player_id === "a")!.net).toBe(45);  // 75 won − 30 paid
    expect(positions.find(p => p.player_id === "b")!.net).toBe(-15); // 15 won − 30 paid
    expect(positions.find(p => p.player_id === "c")!.net).toBe(-30); // 0 won − 30 paid
  });
});

describe("simplifyDebts", () => {
  it("flattens a chain: X→Y and Y→Z become X→Z", () => {
    // Net balances equivalent to X owes Y €10 and Y owes Z €10:
    //   X: -10, Y: 0, Z: +10  →  single transfer X → Z €10.
    const transfers = simplifyDebts([
      { player_id: "x", name: "X", net: -10 },
      { player_id: "y", name: "Y", net: 0 },
      { player_id: "z", name: "Z", net: 10 },
    ]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ from: "x", to: "z", amount: 10 });
  });

  it("settles a simple pot with the minimum number of transfers", () => {
    // A is owed 60; B and C each owe 30 → 2 transfers.
    const transfers = simplifyDebts([
      { player_id: "a", name: "A", net: 60 },
      { player_id: "b", name: "B", net: -30 },
      { player_id: "c", name: "C", net: -30 },
    ]);
    expect(transfers).toHaveLength(2);
    for (const tr of transfers) expect(tr.to).toBe("a");
    expect(transfers.reduce((s, t) => s + t.amount, 0)).toBe(60);
  });

  it("produces at most N-1 transfers and conserves every balance", () => {
    const positions = [
      { player_id: "a", name: "A", net: 100 },
      { player_id: "b", name: "B", net: -55 },
      { player_id: "c", name: "C", net: -20 },
      { player_id: "d", name: "D", net: 35 },
      { player_id: "e", name: "E", net: -60 },
    ];
    const transfers = simplifyDebts(positions);
    expect(transfers.length).toBeLessThanOrEqual(positions.length - 1);
    // Each player's received-minus-paid must equal their net.
    const delta = new Map<string, number>();
    for (const tr of transfers) {
      delta.set(tr.to, (delta.get(tr.to) ?? 0) + tr.amount);
      delta.set(tr.from, (delta.get(tr.from) ?? 0) - tr.amount);
    }
    for (const p of positions) {
      expect(round2(delta.get(p.player_id) ?? 0)).toBe(p.net);
    }
  });

  it("absorbs a cent of rounding so it still balances", () => {
    // Sums to +0.01; the residual is nudged into the biggest-magnitude entry.
    const transfers = simplifyDebts([
      { player_id: "a", name: "A", net: 33.34 },
      { player_id: "b", name: "B", net: -16.67 },
      { player_id: "c", name: "C", net: -16.66 },
    ]);
    const received = transfers.filter(t => t.to === "a").reduce((s, t) => s + t.amount, 0);
    // A can't receive more than the debtors actually owe.
    expect(round2(received)).toBe(33.33);
  });

  it("returns no transfers when everyone is even", () => {
    expect(simplifyDebts([
      { player_id: "a", name: "A", net: 0 },
      { player_id: "b", name: "B", net: 0 },
    ])).toEqual([]);
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
