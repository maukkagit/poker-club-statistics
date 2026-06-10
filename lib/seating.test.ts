import { describe, it, expect } from "vitest";
import {
  seatingDefaults,
  drawSeats,
  computeBlinds,
  buttonFromBigBlind,
  rebalanceSuggestion,
  applyMove,
  applyBreak,
  seatPositions,
  shuffle,
  mulberry32,
  MAX_SEATS_PER_TABLE,
  type DrawPlayer,
  type Layout,
} from "./seating";

function players(n: number): DrawPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ player_id: `p${i + 1}` }));
}

// A fixed-sequence RNG so we can reason about exact placements in tests.
function rngFromSequence(seq: number[]) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

describe("seatingDefaults", () => {
  it("uses one 9-handed table up to 9 players", () => {
    expect(seatingDefaults(2)).toEqual({ tables: 1, seats_per_table: 9 });
    expect(seatingDefaults(9)).toEqual({ tables: 1, seats_per_table: 9 });
  });
  it("uses two tables for 10–14 players, split evenly", () => {
    expect(seatingDefaults(10)).toEqual({ tables: 2, seats_per_table: 5 });
    expect(seatingDefaults(14)).toEqual({ tables: 2, seats_per_table: 7 });
  });
  it("uses 6-max tables beyond 14 players", () => {
    expect(seatingDefaults(15)).toEqual({ tables: 3, seats_per_table: 6 });
    expect(seatingDefaults(18)).toEqual({ tables: 3, seats_per_table: 6 });
    expect(seatingDefaults(19)).toEqual({ tables: 4, seats_per_table: 6 });
  });
  it("never exceeds the seat cap", () => {
    for (let n = 0; n <= 60; n++) {
      expect(seatingDefaults(n).seats_per_table).toBeLessThanOrEqual(MAX_SEATS_PER_TABLE);
    }
  });
});

describe("shuffle", () => {
  it("is a permutation (no loss/duplication) and is pure", () => {
    const input = players(20);
    const out = shuffle(input, mulberry32(123));
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map(p => p.player_id))).toEqual(new Set(input.map(p => p.player_id)));
    // original untouched
    expect(input.map(p => p.player_id)).toEqual(players(20).map(p => p.player_id));
  });
  it("is deterministic for a given seed", () => {
    const a = shuffle(players(20), mulberry32(7)).map(p => p.player_id);
    const b = shuffle(players(20), mulberry32(7)).map(p => p.player_id);
    expect(a).toEqual(b);
  });
});

describe("drawSeats (plain)", () => {
  it("seats everyone exactly once with gapless seat numbers per table", () => {
    const out = drawSeats(players(18), 3, 6, mulberry32(42));
    expect(out).toHaveLength(18);
    // every player present once
    expect(new Set(out.map(a => a.player_id)).size).toBe(18);
    // group by table, check seat_no is 1..k with no gaps/dupes
    const byTable = new Map<number, number[]>();
    for (const a of out) {
      if (!byTable.has(a.table_no)) byTable.set(a.table_no, []);
      byTable.get(a.table_no)!.push(a.seat_no);
    }
    expect([...byTable.keys()].sort()).toEqual([1, 2, 3]);
    for (const seats of byTable.values()) {
      const sorted = [...seats].sort((x, y) => x - y);
      expect(sorted).toEqual(Array.from({ length: sorted.length }, (_, i) => i + 1));
    }
  });
  it("round-robins so tables stay within one player of each other", () => {
    const out = drawSeats(players(17), 3, 6, mulberry32(99));
    const counts = new Map<number, number>();
    for (const a of out) counts.set(a.table_no, (counts.get(a.table_no) ?? 0) + 1);
    const sizes = [...counts.values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
  it("is deterministic for a given seed", () => {
    const a = drawSeats(players(12), 2, 6, mulberry32(5));
    const b = drawSeats(players(12), 2, 6, mulberry32(5));
    expect(a).toEqual(b);
  });
});

describe("drawSeats (bucketed)", () => {
  it("spreads even buckets evenly across tables (18 players / 3 tables / 3 buckets)", () => {
    const ps = players(18);
    const bucketByPlayerId: Record<string, number> = {};
    ps.forEach((p, i) => { bucketByPlayerId[p.player_id] = Math.floor(i / 6) + 1; }); // 6 each in buckets 1,2,3
    const out = drawSeats(ps, 3, 6, mulberry32(1), { bucketByPlayerId });
    // each table should have exactly 2 players from each bucket
    const tableBucketCounts = new Map<number, Map<number, number>>();
    for (const a of out) {
      const b = bucketByPlayerId[a.player_id];
      if (!tableBucketCounts.has(a.table_no)) tableBucketCounts.set(a.table_no, new Map());
      const m = tableBucketCounts.get(a.table_no)!;
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    expect(tableBucketCounts.size).toBe(3);
    for (const m of tableBucketCounts.values()) {
      expect(m.get(1)).toBe(2);
      expect(m.get(2)).toBe(2);
      expect(m.get(3)).toBe(2);
    }
  });
  it("handles uneven bucket sizes without losing players", () => {
    const ps = players(10);
    const bucketByPlayerId: Record<string, number> = {};
    // buckets: 4 / 3 / 3
    ps.forEach((p, i) => { bucketByPlayerId[p.player_id] = i < 4 ? 1 : i < 7 ? 2 : 3; });
    const out = drawSeats(ps, 3, 4, mulberry32(2), { bucketByPlayerId });
    expect(out).toHaveLength(10);
    expect(new Set(out.map(a => a.player_id)).size).toBe(10);
    const counts = new Map<number, number>();
    for (const a of out) counts.set(a.table_no, (counts.get(a.table_no) ?? 0) + 1);
    const sizes = [...counts.values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
  it("falls back to plain draw when no player has a bucket", () => {
    const ps = players(6);
    const out = drawSeats(ps, 2, 6, mulberry32(3), { bucketByPlayerId: {} });
    expect(out).toHaveLength(6);
  });
});

describe("computeBlinds", () => {
  it("ring of 1 collapses everything onto the same player", () => {
    const b = computeBlinds(["a"], 0);
    expect(b).toMatchObject({ button: "a", sb: "a", bb: "a" });
  });
  it("heads-up: button is the small blind", () => {
    const b = computeBlinds(["a", "b"], 0);
    expect(b.button).toBe("a");
    expect(b.sb).toBe("a");
    expect(b.bb).toBe("b");
  });
  it("3+ handed: SB then BB clockwise from button, wrapping", () => {
    const ring = ["a", "b", "c", "d"];
    expect(computeBlinds(ring, 0)).toMatchObject({ button: "a", sb: "b", bb: "c" });
    expect(computeBlinds(ring, 3)).toMatchObject({ button: "d", sb: "a", bb: "b" });
  });
});

describe("buttonFromBigBlind", () => {
  it("3+ handed: button is two seats before the BB", () => {
    expect(buttonFromBigBlind(6, 2)).toBe(0);
    expect(buttonFromBigBlind(6, 0)).toBe(4);
  });
  it("heads-up: button is the other player", () => {
    expect(buttonFromBigBlind(2, 1)).toBe(0);
    expect(buttonFromBigBlind(2, 0)).toBe(1);
  });
  it("round-trips with computeBlinds", () => {
    const ring = ["a", "b", "c", "d", "e"];
    for (let bb = 0; bb < ring.length; bb++) {
      const btn = buttonFromBigBlind(ring.length, bb);
      expect(computeBlinds(ring, btn).bbIndex).toBe(bb);
    }
  });
});

describe("rebalanceSuggestion", () => {
  const layout = (sizes: number[], spt: number): Layout => ({
    seats_per_table: spt,
    tables: sizes.map((s, i) => ({
      table_no: i + 1,
      occupants: Array.from({ length: s }, (_, j) => `t${i + 1}p${j + 1}`),
    })),
  });

  it("returns none for a single table", () => {
    expect(rebalanceSuggestion(layout([5], 9)).kind).toBe("none");
  });
  it("suggests a move when tables differ by more than one", () => {
    const s = rebalanceSuggestion(layout([6, 3], 6));
    expect(s.kind).toBe("move");
    if (s.kind === "move") {
      expect(s.fromTable).toBe(1);
      expect(s.toTable).toBe(2);
    }
  });
  it("does not suggest a move when within one", () => {
    expect(rebalanceSuggestion(layout([6, 5], 6)).kind).toBe("none");
  });
  it("suggests breaking the shortest table when one fewer would fit", () => {
    // 3 tables of 6 cap, 10 alive -> fits on 2 tables -> break shortest
    const s = rebalanceSuggestion(layout([4, 3, 3], 6));
    expect(s.kind).toBe("break");
    if (s.kind === "break") expect(s.breakTable).toBe(2); // shortest, lowest table_no tiebreak
  });
  it("suggests a final table when everyone fits on one", () => {
    const s = rebalanceSuggestion(layout([3, 2], 6));
    expect(s.kind).toBe("final");
    if (s.kind === "final") expect(s.intoTable).toBe(1);
  });
  it("ignores empty (already broken) tables", () => {
    expect(rebalanceSuggestion(layout([5, 0], 9)).kind).toBe("none");
  });
});

describe("applyMove", () => {
  const base: Layout = {
    seats_per_table: 6,
    tables: [
      { table_no: 1, occupants: ["a", "b", "c", "d"] },
      { table_no: 2, occupants: ["e", "f"] },
    ],
  };
  it("moves the named player and re-indexes (gapless)", () => {
    const next = applyMove(base, 1, 2, "b");
    expect(next.tables[0].occupants).toEqual(["a", "c", "d"]);
    expect(next.tables[1].occupants).toEqual(["e", "f", "b"]);
    // original untouched (pure)
    expect(base.tables[0].occupants).toEqual(["a", "b", "c", "d"]);
  });
  it("moves the last seat when no player specified", () => {
    const next = applyMove(base, 1, 2);
    expect(next.tables[0].occupants).toEqual(["a", "b", "c"]);
    expect(next.tables[1].occupants).toEqual(["e", "f", "d"]);
  });
});

describe("applyBreak", () => {
  it("redistributes the broken table evenly into the others", () => {
    const layout: Layout = {
      seats_per_table: 6,
      tables: [
        { table_no: 1, occupants: ["a", "b"] },
        { table_no: 2, occupants: ["c", "d"] },
        { table_no: 3, occupants: ["e", "f"] },
      ],
    };
    const next = applyBreak(layout, 3);
    expect(next.tables.find(t => t.table_no === 3)!.occupants).toEqual([]);
    const remaining = next.tables.filter(t => t.table_no !== 3);
    const total = remaining.reduce((s, t) => s + t.occupants.length, 0);
    expect(total).toBe(6);
    const sizes = remaining.map(t => t.occupants.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
});

describe("seatPositions", () => {
  it("returns one point per occupant", () => {
    expect(seatPositions(0)).toHaveLength(0);
    expect(seatPositions(6)).toHaveLength(6);
    expect(seatPositions(10)).toHaveLength(10);
  });
  it("starts at bottom-center", () => {
    const [first] = seatPositions(8, { cx: 50, cy: 30, rx: 44, ry: 24 });
    expect(first.x).toBeCloseTo(50, 5);
    expect(first.y).toBeGreaterThan(30); // below center in SVG coords
  });
  it("keeps points within the table bounds", () => {
    for (const p of seatPositions(10, { cx: 50, cy: 30, rx: 44, ry: 24 })) {
      expect(p.x).toBeGreaterThanOrEqual(50 - 44 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(50 + 44 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(30 - 24 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(30 + 24 + 1e-6);
    }
  });
  it("advances clockwise (bottom -> bottom-left first)", () => {
    const pts = seatPositions(4, { cx: 50, cy: 30, rx: 44, ry: 24 });
    // second seat should be to the left of and not below the first
    expect(pts[1].x).toBeLessThan(pts[0].x);
  });
});
