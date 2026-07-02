import { NextResponse } from "next/server";
import { getTournamentByShareToken, listEntriesFor, listKnockoutsFor, getPlayerNames } from "@/lib/db";
import { buyInSubtitle, computeClockAggregates } from "@/lib/tournament-clock";
import { computeBountyState, bountyConfig } from "@/lib/pko";
import type { PublicClock } from "@/lib/types";

// Public, unauthenticated read-only endpoint behind the share token. Excluded
// from the auth gate in middleware.ts. Returns ONLY what the projector clock
// needs — no player names or ids, no seating — so a shared link can't leak the
// roster. Viewers poll this and also receive a realtime "changed" nudge.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t = await getTournamentByShareToken(params.token);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  const entries = await listEntriesFor(t.id);
  const agg = computeClockAggregates(
    entries.map(e => ({ buy_ins: e.buy_ins, finish_position: e.finish_position })),
    { buyInAmount: t.buy_in_amount, startingStack: t.starting_stack },
  );

  // Payout amounts per paid position (deal override if set, else pool × pct).
  // Names are intentionally omitted from the public payload.
  const payouts = [...t.payout_structure]
    .sort((a, b) => a.position - b.position)
    .map(slot => {
      const override = t.payout_overrides?.[String(slot.position)];
      return {
        position: slot.position,
        amount: override != null ? override : agg.prizePool * (slot.pct / 100),
      };
    });

  // PKO: attach a bounty summary. Only the current leader's name is exposed —
  // the rest of the roster stays private, matching this endpoint's no-roster
  // contract. The prize pool above already uses the regular buy-in only.
  let bounty: PublicClock["bounty"] = null;
  if (t.is_pko) {
    const knockouts = await listKnockoutsFor(t.id);
    const champion = entries.find(e => e.finish_position === 1)?.player_id ?? null;
    const state = computeBountyState(entries.map(e => e.player_id), knockouts, bountyConfig(t), champion);
    let leader: NonNullable<PublicClock["bounty"]>["leader"] = null;
    if (state.leader) {
      const names = await getPlayerNames([state.leader.player_id]);
      leader = {
        name: names.get(state.leader.player_id) ?? "A player",
        koCount: state.leader.koCount,
        cashWon: state.leader.cashWon,
      };
    }
    // Bounty money still in play = every starting bounty granted (one per
    // buy-in / re-entry) minus the cash already paid out from bounties.
    const bountyMoneyTotal = agg.totalBuyIns * (t.bounty_start_amount ?? 0);
    const inPlay = Math.max(0, bountyMoneyTotal - state.totalCashPaid);
    bounty = { leader, totalCashPaid: state.totalCashPaid, inPlay };
  }

  // PKO clock shows the full pool (regular + bounty money). The stored
  // buy_in_amount is the regular-pool part, so add back the bounty per entry.
  const prizePoolTotal = t.is_pko
    ? agg.prizePool + agg.totalBuyIns * (t.bounty_start_amount ?? 0)
    : undefined;

  const payload: PublicClock = {
    title: (t.name ?? "").trim() || "Tournament",
    subtitle: buyInSubtitle({
      // Total entry price: for PKO the stored buy_in_amount is only the
      // prize-pool part, so add the per-entry bounty back on.
      buyInAmount: t.is_pko ? t.buy_in_amount + (t.bounty_start_amount ?? 0) : t.buy_in_amount,
      rebuysAllowed: t.rebuys_allowed,
      rebuyWindowOpen: t.rebuy_window_open,
    }),
    state: t.state,
    structure: t.structure ?? [],
    starting_stack: t.starting_stack ?? null,
    clock: t.clock ?? null,
    aggregates: agg,
    payouts,
    isPko: !!t.is_pko,
    soundEnabled: t.sound_enabled !== false,
    soundKnockouts: t.sound_knockouts_enabled !== false,
    titleGradient: t.title_gradient_enabled !== false,
    prizePoolTotal,
    bounty,
  };
  return NextResponse.json(payload);
}
