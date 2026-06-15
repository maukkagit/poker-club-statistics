import { describe, it, expect } from "vitest";
import { roundUpToChip, isBountyPhase, bountyPhaseAt, computeBountyState, splitBountyChips, formatKoCount } from "@/lib/pko";
import type { Knockout } from "@/lib/types";

let seq = 0;
function ko(
  eliminator: string,
  eliminated: string,
  phase: "pre" | "bounty",
  reentry = false,
): Knockout {
  seq += 1;
  return {
    id: `k${seq}`,
    tournament_id: "t1",
    eliminator_player_id: eliminator,
    eliminated_player_id: eliminated,
    phase,
    reentry,
    bust_event_id: `e${seq}`,
    split_index: 0,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
  };
}

/**
 * A single elimination split across several winners: one row per winner, all
 * sharing a bust_event_id, ordered by odd-chip priority.
 */
function splitKo(
  eliminators: string[],
  eliminated: string,
  phase: "pre" | "bounty",
  reentry = false,
): Knockout[] {
  seq += 1;
  const eventId = `e${seq}`;
  const created = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
  return eliminators.map((eliminator, i) => ({
    id: `k${seq}_${i}`,
    tournament_id: "t1",
    eliminator_player_id: eliminator,
    eliminated_player_id: eliminated,
    phase,
    reentry,
    bust_event_id: eventId,
    split_index: i,
    created_at: created,
  }));
}

const CFG = { startAmount: 15, roundTo: 2.5 };

describe("roundUpToChip", () => {
  it("rounds up to the nearest chip", () => {
    expect(roundUpToChip(7.5, 2.5)).toBe(7.5);
    expect(roundUpToChip(6.25, 2.5)).toBe(7.5);
    expect(roundUpToChip(8.75, 2.5)).toBe(10);
    expect(roundUpToChip(0, 2.5)).toBe(0);
  });
  it("is float-drift safe at exact multiples", () => {
    expect(roundUpToChip(15 / 2, 2.5)).toBe(7.5);
    expect(roundUpToChip(2.5, 2.5)).toBe(2.5);
  });
});

describe("phase helpers", () => {
  it("isBountyPhase compares level to the start level", () => {
    expect(isBountyPhase(10, 11)).toBe(false);
    expect(isBountyPhase(11, 11)).toBe(true);
    expect(isBountyPhase(12, 11)).toBe(true);
    expect(isBountyPhase(null, 11)).toBe(false);
    expect(isBountyPhase(11, null)).toBe(false);
  });
  it("bountyPhaseAt returns the phase string", () => {
    expect(bountyPhaseAt(5, 11)).toBe("pre");
    expect(bountyPhaseAt(11, 11)).toBe("bounty");
  });
});

describe("computeBountyState", () => {
  it("pre-bounty: transfers 100% of the bounty, no cash", () => {
    const s = computeBountyState(["A", "B"], [ko("A", "B", "pre")], CFG);
    expect(s.byPlayer.get("A")).toMatchObject({ current: 30, cashWon: 0, koCount: 1 });
    expect(s.byPlayer.get("B")).toMatchObject({ current: 0, cashWon: 0, koCount: 0 });
    expect(s.totalCashPaid).toBe(0);
    expect(s.leader?.player_id).toBe("A");
  });

  it("pre-bounty re-entry resets the eliminated player's bounty", () => {
    const s = computeBountyState(["A", "B"], [ko("A", "B", "pre", true)], CFG);
    expect(s.byPlayer.get("A")?.current).toBe(30);
    expect(s.byPlayer.get("B")?.current).toBe(15);
  });

  it("bounty phase: 50% cash (rounded up) to the hunter, remainder compounds", () => {
    const s = computeBountyState(["A", "B"], [ko("A", "B", "bounty")], CFG);
    // victim bounty 15 -> cash = roundUp(7.5) = 7.5, remainder 7.5 onto A's head.
    expect(s.byPlayer.get("A")).toMatchObject({ current: 22.5, cashWon: 7.5, koCount: 1 });
    expect(s.byPlayer.get("B")?.current).toBe(0);
    expect(s.totalCashPaid).toBe(7.5);
  });

  it("compounds and rounds across multiple bounty-phase knockouts", () => {
    // A busts B (pre): A=30. A busts C (bounty): cash 7.5, A=37.5. D busts A (bounty):
    // victim 37.5 -> cash roundUp(18.75)=20, remainder 17.5 onto D.
    const s = computeBountyState(
      ["A", "B", "C", "D"],
      [ko("A", "B", "pre"), ko("A", "C", "bounty"), ko("D", "A", "bounty")],
      CFG,
    );
    expect(s.byPlayer.get("A")).toMatchObject({ current: 0, cashWon: 7.5, koCount: 2 });
    expect(s.byPlayer.get("D")).toMatchObject({ current: 32.5, cashWon: 20, koCount: 1 });
    expect(s.totalCashPaid).toBe(27.5);
  });

  it("splits the knockout count by phase", () => {
    const s = computeBountyState(
      ["A", "B", "C", "D"],
      [ko("A", "B", "pre"), ko("A", "C", "bounty"), ko("D", "A", "bounty")],
      CFG,
    );
    expect(s.byPlayer.get("A")).toMatchObject({ koCount: 2, koCountPre: 1, koCountBounty: 1 });
    expect(s.byPlayer.get("D")).toMatchObject({ koCount: 1, koCountPre: 0, koCountBounty: 1 });
    expect(s.byPlayer.get("B")).toMatchObject({ koCount: 0, koCountPre: 0, koCountBounty: 0 });
  });

  it("the champion cashes their own final bounty in full", () => {
    const s = computeBountyState(["A", "B"], [ko("A", "B", "bounty")], CFG, "A");
    // A had current 22.5 -> moved to cashWon (7.5 + 22.5 = 30), current 0.
    expect(s.byPlayer.get("A")).toMatchObject({ current: 0, cashWon: 30 });
    expect(s.totalCashPaid).toBe(30);
  });

  it("no knockouts => no leader", () => {
    const s = computeBountyState(["A", "B"], [], CFG);
    expect(s.leader).toBeNull();
    expect(s.totalCashPaid).toBe(0);
  });

  it("split pot (pre-bounty): divides the bounty evenly and credits 1/N KO each", () => {
    // B (head 15) busted by A and C in a chopped pot: 6 chips split 3/3.
    const s = computeBountyState(["A", "B", "C"], splitKo(["A", "C"], "B", "pre"), CFG);
    expect(s.byPlayer.get("A")).toMatchObject({ current: 22.5, cashWon: 0, koCount: 0.5, koCountPre: 0.5 });
    expect(s.byPlayer.get("C")).toMatchObject({ current: 22.5, cashWon: 0, koCount: 0.5, koCountPre: 0.5 });
    expect(s.byPlayer.get("B")?.current).toBe(0);
  });

  it("split pot with an odd chip awards the extra chip to the priority winner", () => {
    // A busts X (bounty, head 15): cash 7.5, remainder 7.5 -> A head 22.5 (9 chips).
    // Then A is busted in a bounty-phase chop by B (priority) and C: 9 chips ->
    // 5 chips (12.5) to B, 4 chips (10) to C.
    const s = computeBountyState(
      ["A", "B", "C", "X"],
      [...splitKo(["A"], "X", "bounty"), ...splitKo(["B", "C"], "A", "bounty")],
      CFG,
    );
    // B share 12.5: cash roundUp(6.25)=7.5, remainder 5 -> head 15 + 5 = 20.
    expect(s.byPlayer.get("B")).toMatchObject({ current: 20, cashWon: 7.5, koCount: 0.5 });
    // C share 10: cash roundUp(5)=5, remainder 5 -> head 15 + 5 = 20.
    expect(s.byPlayer.get("C")).toMatchObject({ current: 20, cashWon: 5, koCount: 0.5 });
    expect(s.byPlayer.get("A")?.current).toBe(0);
  });

  it("splitBountyChips: even split, odd chip to the front, and n=1 exact", () => {
    expect(splitBountyChips(15, 2, 2.5)).toEqual([7.5, 7.5]);
    expect(splitBountyChips(17.5, 2, 2.5)).toEqual([10, 7.5]);
    expect(splitBountyChips(15, 3, 2.5)).toEqual([5, 5, 5]);
    expect(splitBountyChips(17.5, 3, 2.5)).toEqual([7.5, 5, 5]);
    expect(splitBountyChips(22.5, 1, 2.5)).toEqual([22.5]);
  });

  it("formatKoCount shows integers plainly and trims fractions", () => {
    expect(formatKoCount(2)).toBe("2");
    expect(formatKoCount(0.5)).toBe("0.5");
    expect(formatKoCount(1.5)).toBe("1.5");
  });

  it("leader is the top hunter by net bounty acquired", () => {
    const s = computeBountyState(
      ["A", "B", "C", "D"],
      [ko("A", "B", "pre"), ko("C", "D", "pre"), ko("C", "A", "pre")],
      CFG,
    );
    // C knocked out D then A (who had absorbed B): C.current = 15 + 15 + 30 = 60.
    expect(s.leader?.player_id).toBe("C");
    expect(s.byPlayer.get("C")?.koCount).toBe(2);
  });
});
