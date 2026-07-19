// Tournament settlement ("who pays who"). Pure, unit-tested money math shared by
// the finish flow. Two steps:
//
//  1. computeNetPositions — turn each player's stake (buy-ins × per-entry cost)
//     and winnings (prize-pool payout + any PKO bounty cash) into a single net
//     balance: positive = the table owes them, negative = they owe the table.
//     Because every euro that goes in comes back out (prize pool + bounty money
//     == total buy-ins), the balances sum to zero.
//
//  2. simplifyDebts — collapse those balances into the fewest direct transfers.
//     Working only on net balances inherently flattens payment chains: if X owes
//     Y and Y owes Z the same amount, Y nets to zero and the result is the single
//     transfer X → Z. We use the standard greedy "minimise cash flow" approach
//     (repeatedly settle the biggest creditor against the biggest debtor), which
//     yields at most N-1 transfers.

/** A player's money position at the end of a tournament. */
export type NetPosition = {
  player_id: string;
  name: string;
  /** Total staked: buy-ins (incl. re-entries) × per-entry cost. */
  paid: number;
  /** Total won: prize-pool payout + bounty cash (EUR). */
  won: number;
  /** won − paid, rounded to cents. Positive = is owed money; negative = owes. */
  net: number;
};

/** A single direct payment from one player to another. */
export type Transfer = {
  from: string;       // player_id who pays
  fromName: string;
  to: string;         // player_id who receives
  toName: string;
  amount: number;     // EUR, > 0
};

export type SettlementPlayer = {
  player_id: string;
  name: string;
  /** Number of buy-ins / re-entries this player paid for. */
  buyIns: number;
  /** Extra cash paid beyond buy-ins (e.g. their own add-on purchases). */
  extraPaid?: number;
  /** Cash won from the prize pool (placement payout). */
  prizeWon: number;
  /** Cash won from bounties (PKO); 0 for normal tournaments. */
  bountyWon: number;
};

/** Round an EUR amount to whole cents (kills floating-point dust). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Net balance per player from their buy-ins and winnings. `perEntryCost` is the
 * full price of one entry (for PKO that's the prize-pool buy-in PLUS the starting
 * bounty, since every re-entry funds a fresh bounty). `extraPaid` (e.g. add-ons)
 * is added on top since it doesn't scale with `buyIns`.
 */
export function computeNetPositions(players: SettlementPlayer[], perEntryCost: number): NetPosition[] {
  return players.map(p => {
    const paid = round2(p.buyIns * perEntryCost + (p.extraPaid ?? 0));
    const won = round2(p.prizeWon + p.bountyWon);
    return { player_id: p.player_id, name: p.name, paid, won, net: round2(won - paid) };
  });
}

/**
 * Collapse net balances into the fewest direct transfers. Operates in integer
 * cents to avoid rounding drift; if the balances don't sum to exactly zero (e.g.
 * a cent of payout rounding) the residual is absorbed by the largest-magnitude
 * balance so the algorithm always terminates cleanly.
 */
export function simplifyDebts(positions: Pick<NetPosition, "player_id" | "name" | "net">[]): Transfer[] {
  const nameById = new Map(positions.map(p => [p.player_id, p.name]));
  const cents = positions.map(p => ({ id: p.player_id, c: Math.round(p.net * 100) }));

  // Force the balances to sum to zero by nudging the biggest-magnitude entry.
  const sum = cents.reduce((s, x) => s + x.c, 0);
  if (sum !== 0 && cents.length > 0) {
    let idx = 0;
    for (let i = 1; i < cents.length; i++) {
      if (Math.abs(cents[i].c) > Math.abs(cents[idx].c)) idx = i;
    }
    cents[idx].c -= sum;
  }

  const transfers: Transfer[] = [];
  // Greedy: each round, the biggest debtor pays the biggest creditor as much as
  // possible, zeroing out at least one of them.
  // Guard the loop against pathological input.
  for (let guard = 0; guard < cents.length * cents.length + 1; guard++) {
    let maxCreditor = -1;
    let maxDebtor = -1;
    for (let i = 0; i < cents.length; i++) {
      if (cents[i].c > 0 && (maxCreditor === -1 || cents[i].c > cents[maxCreditor].c)) maxCreditor = i;
      if (cents[i].c < 0 && (maxDebtor === -1 || cents[i].c < cents[maxDebtor].c)) maxDebtor = i;
    }
    if (maxCreditor === -1 || maxDebtor === -1) break;
    const settle = Math.min(cents[maxCreditor].c, -cents[maxDebtor].c);
    cents[maxCreditor].c -= settle;
    cents[maxDebtor].c += settle;
    transfers.push({
      from: cents[maxDebtor].id,
      fromName: nameById.get(cents[maxDebtor].id) ?? "?",
      to: cents[maxCreditor].id,
      toName: nameById.get(cents[maxCreditor].id) ?? "?",
      amount: round2(settle / 100),
    });
  }
  return transfers;
}
