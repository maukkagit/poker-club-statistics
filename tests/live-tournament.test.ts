import { describe, it, expect } from "vitest";
import {
  partitionEntries, buildOccupiedByTable, buildFreeSlots, buildPodium, buildLayout, buildTableViews,
  vacatedSeatForTable, type LiveEntry,
} from "@/lib/live-tournament";

function entry(over: Partial<LiveEntry> & { player_id: string }): LiveEntry {
  return {
    player_id: over.player_id,
    buy_ins: over.buy_ins ?? 1,
    finish_position: over.finish_position ?? null,
    table_no: over.table_no ?? null,
    seat_no: over.seat_no ?? null,
    bucket: over.bucket ?? null,
    payout: over.payout ?? 0,
    last_table_no: over.last_table_no ?? null,
    last_seat_no: over.last_seat_no ?? null,
  };
}

const nameById = new Map([["p1", "Alice"], ["p2", "Bob"], ["p3", "Cara"], ["p4", "Dan"]]);

describe("partitionEntries", () => {
  it("splits alive/busted/seated and sorts busted by finish position", () => {
    const entries = [
      entry({ player_id: "p1", table_no: 1, seat_no: 1 }),
      entry({ player_id: "p2", finish_position: 3 }),
      entry({ player_id: "p3", finish_position: 1 }),
      entry({ player_id: "p4" }), // alive, unseated
    ];
    const { alive, busted, seated } = partitionEntries(entries);
    expect(alive.map(e => e.player_id).sort()).toEqual(["p1", "p4"]);
    expect(busted.map(e => e.player_id)).toEqual(["p3", "p2"]); // 1 then 3
    expect(seated.map(e => e.player_id)).toEqual(["p1"]);
  });
});

describe("buildPodium", () => {
  const structure = [{ position: 1, pct: 70 }, { position: 2, pct: 30 }];

  it("pays the % split when there is no deal, and fills finisher names", () => {
    const entries = [entry({ player_id: "p1", finish_position: 1 })];
    const podium = buildPodium(structure, 100, null, entries, nameById);
    expect(podium).toEqual([
      { position: 1, pct: 70, amount: 70, originalAmount: 70, player_id: "p1", name: "Alice" },
      { position: 2, pct: 30, amount: 30, originalAmount: 30, player_id: null, name: "—" },
    ]);
  });

  it("uses the deal override for amount while keeping originalAmount = pool × pct", () => {
    const podium = buildPodium(structure, 100, { "1": 80 }, [], nameById);
    expect(podium[0]).toMatchObject({ position: 1, amount: 80, originalAmount: 70 });
  });
});

describe("buildLayout + table helpers", () => {
  it("groups seated players by table in seat order", () => {
    const seated = [
      entry({ player_id: "p2", table_no: 1, seat_no: 3 }),
      entry({ player_id: "p1", table_no: 1, seat_no: 1 }),
      entry({ player_id: "p3", table_no: 2, seat_no: 2 }),
    ];
    const layout = buildLayout(seated, 9);
    expect(layout.seats_per_table).toBe(9);
    expect(layout.tables).toEqual([
      { table_no: 1, occupants: ["p1", "p2"] },
      { table_no: 2, occupants: ["p3"] },
    ]);

    const occupied = buildOccupiedByTable(seated);
    expect(occupied.get(1)).toEqual([3, 1]);

    const views = buildTableViews(occupied, seated, nameById);
    expect(views[0].table_no).toBe(1);
    expect(views[0].occupants.map(o => o.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("buildFreeSlots lists open chairs per table only when seats are drawn", () => {
    const occupied = new Map<number, number[]>([[1, [1]], [2, []]]);
    const slots = buildFreeSlots(true, 2, occupied, 3);
    expect(slots).toEqual([
      { table_no: 1, seat_no: 2 },
      { table_no: 1, seat_no: 3 },
      { table_no: 2, seat_no: 1 },
      { table_no: 2, seat_no: 2 },
      { table_no: 2, seat_no: 3 },
    ]);
    expect(buildFreeSlots(false, 2, occupied, 3)).toEqual([]);
  });
});

describe("vacatedSeatForTable", () => {
  it("returns the most recently busted player's seat at the table when still free", () => {
    const entries = [
      entry({ player_id: "p1", table_no: 1, seat_no: 1 }),       // alive, seated
      entry({ player_id: "p2", finish_position: 8, last_table_no: 1, last_seat_no: 3 }), // earlier bust
      entry({ player_id: "p3", finish_position: 5, last_table_no: 1, last_seat_no: 6 }), // later bust (smaller pos)
    ];
    // Seat 1 is taken; both seats 3 and 6 are free → pick the later bust (p3, seat 6).
    expect(vacatedSeatForTable(entries, 1, [1])).toBe(6);
  });

  it("skips a vacated seat that has since been reoccupied, and ignores other tables", () => {
    const entries = [
      entry({ player_id: "p3", finish_position: 5, last_table_no: 1, last_seat_no: 6 }), // seat now taken
      entry({ player_id: "p2", finish_position: 8, last_table_no: 1, last_seat_no: 3 }),
      entry({ player_id: "p4", finish_position: 2, last_table_no: 2, last_seat_no: 4 }), // different table
    ];
    expect(vacatedSeatForTable(entries, 1, [6])).toBe(3);
  });

  it("returns null when no busted player vacated a free seat at the table", () => {
    const entries = [entry({ player_id: "p1", table_no: 1, seat_no: 1 })];
    expect(vacatedSeatForTable(entries, 1, [1])).toBeNull();
  });
});
