import { NextResponse } from "next/server";
import { getTournamentByShareToken, listEntriesFor } from "@/lib/db";
import { buyInSubtitle, computeClockAggregates } from "@/lib/tournament-clock";
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

  const payload: PublicClock = {
    title: (t.name ?? "").trim() || "Tournament",
    subtitle: buyInSubtitle({
      buyInAmount: t.buy_in_amount,
      rebuysAllowed: t.rebuys_allowed,
      rebuyWindowOpen: t.rebuy_window_open,
    }),
    state: t.state,
    structure: t.structure ?? [],
    starting_stack: t.starting_stack ?? null,
    clock: t.clock ?? null,
    aggregates: agg,
    payouts,
  };
  return NextResponse.json(payload);
}
