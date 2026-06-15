// Pure delayed-PKO bounty engine. The `knockouts` ledger (who busted whom, in
// which phase, and whether the victim re-entered) is the source of truth;
// every bounty value — each player's live bounty, cash won, KO count, the total
// cash paid out, and the current leader — is DERIVED here by replaying the
// ledger in order. Keeping the math in one pure, unit-tested place means the
// server (clock API, stats) and the browser (live manager) always agree, and
// "undo" is just "drop the last knockout and recompute".
//
// Rules (see the tournament guide, Attachment 4):
//  - Pre-bounty phase: 100% of the eliminated player's current bounty is added
//    to the eliminator's bounty. No cash is awarded.
//  - Bounty phase: 50% of the eliminated player's current bounty is awarded to
//    the eliminator as cash, rounded UP to the nearest bounty chip (e.g. 2.50);
//    the remainder compounds into the eliminator's bounty.
//  - The tournament winner keeps their own final bounty in full (as cash).
//  - Split pots ("Bounty allocation edge cases"): when the pot holding the
//    busted player's last chips is chopped, their bounty is split between the
//    winners. The split happens in whole bounty chips; any indivisible chip goes
//    to the winner with the highest priority (closest to the left of the
//    button). Each winner's share is then resolved under the phase rule above,
//    and each winner is credited with a 1/N share of the knockout.
import type { Knockout, Tournament } from "@/lib/types";

export type BountyConfig = {
  /** Starting bounty granted per buy-in / re-entry (EUR). */
  startAmount: number;
  /** Smallest cash increment a bounty payout is rounded up to (EUR). */
  roundTo: number;
};

export type BountyPlayerState = {
  player_id: string;
  /** Live bounty currently on the player's head (EUR). */
  current: number;
  /** Cash bounty won so far (EUR) — bounty-phase payouts + own final bounty. */
  cashWon: number;
  /** Total players this player has knocked out (pre + bounty phase). */
  koCount: number;
  /** Knockouts made during the pre-bounty phase (no cash, head transfers). */
  koCountPre: number;
  /** Knockouts made during the bounty phase (half cash, remainder compounds). */
  koCountBounty: number;
};

export type BountyState = {
  byPlayer: Map<string, BountyPlayerState>;
  /** Total cash bounty paid out across all players (EUR). */
  totalCashPaid: number;
  /** The current bounty leader (top hunter), or null if nobody has a KO yet. */
  leader: BountyPlayerState | null;
};

/**
 * Group a ledger (oldest first) into eliminations. Rows sharing a
 * `bust_event_id` belong to the same (possibly chopped) pot; the ledger order
 * already keeps them contiguous so a single linear pass is enough.
 */
function groupByEvent(knockouts: Knockout[]): Knockout[][] {
  const events: Knockout[][] = [];
  let curId: string | null = null;
  for (const ko of knockouts) {
    const eid = ko.bust_event_id || ko.id;
    if (eid !== curId || events.length === 0) {
      events.push([ko]);
      curId = eid;
    } else {
      events[events.length - 1].push(ko);
    }
  }
  return events;
}

/**
 * Split a bounty (EUR) between `n` winners in whole bounty chips. Each winner
 * gets `floor(totalChips / n)` chips; the leftover chips are handed out one at a
 * time from the front of the list (highest odd-chip priority first), per the
 * "indivisible €2.50 chip" rule. Returns each winner's share in EUR, summing
 * back to the original bounty. `n === 1` returns the exact bounty (no rounding).
 */
export function splitBountyChips(bounty: number, n: number, step: number): number[] {
  if (n <= 1) return [round2(bounty)];
  if (!(step > 0)) {
    const each = round2(bounty / n);
    return Array.from({ length: n }, () => each);
  }
  const totalChips = Math.round(bounty / step);
  const base = Math.floor(totalChips / n);
  const extra = totalChips - base * n;
  return Array.from({ length: n }, (_, i) => round2((base + (i < extra ? 1 : 0)) * step));
}

/** Round `value` UP to the nearest `step` (EUR), guarded against float drift. */
export function roundUpToChip(value: number, step: number): number {
  if (!(step > 0)) return round2(value);
  const chips = Math.ceil(value / step - 1e-9);
  return round2(chips * step);
}

/** Round an EUR amount to whole cents (kills accumulated floating-point dust). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Format a (possibly fractional) KO count for display. Shared knockouts credit
 * each winner a 1/N share, so counts can be e.g. 0.5 or 1.5. Whole numbers show
 * as integers; fractions keep up to two decimals with trailing zeros trimmed.
 */
export function formatKoCount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(2)).toString();
}

/** The PKO bounty configuration for a tournament. */
export function bountyConfig(t: Pick<Tournament, "bounty_start_amount" | "bounty_chip">): BountyConfig {
  return {
    startAmount: t.bounty_start_amount && t.bounty_start_amount > 0 ? t.bounty_start_amount : 0,
    roundTo: t.bounty_chip && t.bounty_chip > 0 ? t.bounty_chip : 2.5,
  };
}

/**
 * Whether the bounty phase is active at `levelNumber` (1-based blind level, or
 * null when on a break / not started). Below `bounty_start_level` — or when no
 * start level is configured — the format is in the pre-bounty phase.
 */
export function isBountyPhase(levelNumber: number | null, startLevel: number | null | undefined): boolean {
  if (levelNumber == null || startLevel == null) return false;
  return levelNumber >= startLevel;
}

/** Phase string ('pre' | 'bounty') for a knockout happening at `levelNumber`. */
export function bountyPhaseAt(levelNumber: number | null, startLevel: number | null | undefined): "pre" | "bounty" {
  return isBountyPhase(levelNumber, startLevel) ? "bounty" : "pre";
}

/**
 * Derive the full bounty state by replaying the ordered knockout ledger.
 *
 * @param playerIds       Every player in the tournament (each starts with one
 *                        starting bounty; re-entries refresh it via the ledger).
 * @param knockouts       Ledger, OLDEST FIRST.
 * @param config          Starting bounty + rounding chip.
 * @param championPlayerId If the tournament is decided, the 1st-place player —
 *                        they cash their own final bounty in full.
 */
export function computeBountyState(
  playerIds: string[],
  knockouts: Knockout[],
  config: BountyConfig,
  championPlayerId?: string | null,
): BountyState {
  const byPlayer = new Map<string, BountyPlayerState>();
  const ensure = (pid: string): BountyPlayerState => {
    let s = byPlayer.get(pid);
    if (!s) {
      s = { player_id: pid, current: config.startAmount, cashWon: 0, koCount: 0, koCountPre: 0, koCountBounty: 0 };
      byPlayer.set(pid, s);
    }
    return s;
  };
  for (const pid of playerIds) ensure(pid);

  // Replay the ledger one *elimination* at a time. Rows sharing a bust_event_id
  // are the winners of a single (possibly chopped) pot and split one bounty.
  for (const group of groupByEvent(knockouts)) {
    const first = group[0];
    if (group.every(ko => ko.eliminator_player_id === first.eliminated_player_id)) continue; // defensive
    const victim = ensure(first.eliminated_player_id);
    const victimBounty = victim.current;
    const phase = first.phase;

    // Winners in odd-chip priority order (closest to the left of the button
    // first). Split the bounty into whole chips; hand the remainder out one chip
    // at a time from the top of that order.
    const winners = group
      .filter(ko => ko.eliminator_player_id !== first.eliminated_player_id)
      .slice()
      .sort((a, b) => a.split_index - b.split_index);
    const shares = splitBountyChips(victimBounty, winners.length, config.roundTo);

    winners.forEach((ko, i) => {
      const hunter = ensure(ko.eliminator_player_id);
      // A shared knockout is worth 1/N of a KO to each winner.
      const koShare = 1 / winners.length;
      hunter.koCount = round2(hunter.koCount + koShare);
      const share = shares[i];
      if (phase === "bounty") {
        hunter.koCountBounty = round2(hunter.koCountBounty + koShare);
        const cash = Math.min(share, roundUpToChip(share / 2, config.roundTo));
        hunter.cashWon = round2(hunter.cashWon + cash);
        hunter.current = round2(hunter.current + (share - cash));
      } else {
        // Pre-bounty: the whole share transfers, no cash.
        hunter.koCountPre = round2(hunter.koCountPre + koShare);
        hunter.current = round2(hunter.current + share);
      }
    });
    // The eliminated player's head is now empty; a re-entry refreshes it.
    victim.current = first.reentry ? config.startAmount : 0;
  }

  // The champion cashes their own final bounty in full once the tournament ends.
  if (championPlayerId) {
    const champ = byPlayer.get(championPlayerId);
    if (champ) {
      champ.cashWon = round2(champ.cashWon + champ.current);
      champ.current = 0;
    }
  }

  let totalCashPaid = 0;
  for (const s of byPlayer.values()) totalCashPaid = round2(totalCashPaid + s.cashWon);

  const leader = knockouts.length === 0 ? null : pickLeader(byPlayer, config.startAmount);
  return { byPlayer, totalCashPaid, leader };
}

/**
 * The "top bounty hunter": highest net bounty acquired (cash won plus live
 * bounty held above their own starting bounty), tie-broken by KO count.
 */
function pickLeader(byPlayer: Map<string, BountyPlayerState>, startAmount: number): BountyPlayerState | null {
  let best: BountyPlayerState | null = null;
  let bestScore = -Infinity;
  for (const s of byPlayer.values()) {
    if (s.koCount === 0) continue;
    const score = s.cashWon + s.current - startAmount;
    if (score > bestScore || (score === bestScore && best && s.koCount > best.koCount)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
