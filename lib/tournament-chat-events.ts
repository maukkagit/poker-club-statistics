// Pure builders for the automated "TD" (tournament-director) chat
// announcements posted on bust-outs, re-entries, and secured paid positions.
// No IO — unit-tested in tests/tournament-chat-events.test.ts and called from
// the live-action API route after the corresponding RPC succeeds.
import { ordinal } from "@/lib/format";

/** Display name the automated announcements are authored under. */
export const TD_AUTHOR = "TD";

/** "{name} busted out & rebought back in!" — a busted player who re-entered. */
export function rebuyMessage(name: string): string {
  return `${name} busted out & rebought back in!`;
}

/** "{name} busted out on {ordinal} place!" — a paid finish (not the win). */
export function securedMessage(name: string, position: number): string {
  return `${name} busted out on ${ordinal(position)} place!`;
}

/** "{name} has won the tournament!" — the champion (1st place). */
export function wonMessage(name: string): string {
  return `${name} has won the tournament!`;
}

/** "{name} busted out!" — a non-paid elimination. */
export function bustedMessage(name: string): string {
  return `${name} busted out!`;
}

/**
 * PKO elimination line: "💥KNOCKOUT💥 {eliminated} was eliminated by
 * {eliminator}!". When the eliminated player re-entered, " --> REBUY" is
 * appended.
 */
export function bustedByMessage(eliminated: string, eliminator: string | string[], reentered: boolean): string {
  const names = Array.isArray(eliminator) ? eliminator : [eliminator];
  const base = `💥KNOCKOUT💥 ${eliminated} was eliminated by ${joinNames(names)}${names.length > 1 ? " (split bounty)" : ""}!`;
  return reentered ? `${base} --> REBUY` : base;
}

/** PKO paid-finish line: "{name} busted out on {ordinal} place! 👏". */
export function knockoutSecuredMessage(name: string, position: number): string {
  return `${name} busted out on ${ordinal(position)} place! 👏`;
}

/** PKO champion line: "{name} wins the tournament!🎉". */
export function knockoutWonMessage(name: string): string {
  return `${name} wins the tournament!🎉`;
}

/** "A", "A and B", or "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type BustEvent = {
  bustedName: string;
  /** The place the busting player just took (null if unknown). */
  bustedFinish: number | null;
  /** Positions that are paid (from the payout structure). */
  paidPositions: Set<number>;
  /** Set only when this very bust crowned the last player as champion. */
  champion?: { name: string; finish: number } | null;
};

/**
 * Messages to post after a bust-out. A paid finish is announced as a "secured
 * place" line; a non-paid finish as a plain "busted out". When the bust leaves
 * a single survivor, the freshly-crowned champion's secured-place line is
 * appended (announced after the runner-up's, matching feed order).
 */
export function bustMessages(ev: BustEvent): string[] {
  const out: string[] = [];
  if (ev.bustedFinish != null && ev.paidPositions.has(ev.bustedFinish)) {
    out.push(securedMessage(ev.bustedName, ev.bustedFinish));
  } else {
    out.push(bustedMessage(ev.bustedName));
  }
  if (ev.champion) {
    out.push(wonMessage(ev.champion.name));
  }
  return out;
}
