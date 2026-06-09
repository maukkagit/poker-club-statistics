import { NextResponse } from "next/server";
import {
  getTournament, updateTournament, deleteTournament, listEntriesFor, replaceEntriesFor, computeEntries,
  listTournaments, computeTournamentOrderNumbers, displayTournamentName,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // Fetch all tournaments in parallel with the focused row's entries so we
  // can resolve this tournament's chronological order number — needed for
  // the "Tournament #34" fallback when the user-supplied name is blank.
  const [tournaments, entries] = await Promise.all([
    listTournaments(),
    listEntriesFor(params.id),
  ]);
  const t = tournaments.find(x => x.id === params.id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const orderById = computeTournamentOrderNumbers(tournaments);
  const order_number = orderById.get(t.id) ?? null;
  const computed = computeEntries(t, entries);
  return NextResponse.json({
    tournament: {
      ...t,
      order_number,
      display_name: displayTournamentName({ name: t.name, order_number, state: t.state }),
    },
    entries: computed,
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const existing = await getTournament(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    if (body.tournament) {
      // Normalise the incoming name (trim) so the "Tournament #N" fallback
      // kicks in for whitespace-only inputs the same way it does for blanks.
      // `state` is whitelisted to the two valid values; missing/unknown
      // values mean "keep existing".
      const incoming = body.tournament as Partial<typeof existing>;
      const nextState = incoming.state === "Active" || incoming.state === "Finished"
        ? incoming.state
        : existing.state;
      // Only touch `special` when the client explicitly sends a boolean. A
      // PUT that doesn't include the field preserves the current value, so
      // older clients can keep saving non-special tournaments without
      // accidentally clearing the flag on a special row.
      const nextSpecial = typeof incoming.special === "boolean"
        ? incoming.special
        : existing.special;
      const merged = {
        ...existing,
        ...incoming,
        name: typeof incoming.name === "string" ? incoming.name.trim() : existing.name,
        state: nextState,
        special: nextSpecial,
        id: existing.id,
        // `created_at` is server-stamped on creation and immutable from this
        // endpoint — refuse to let a PUT body overwrite it (the spread above
        // would otherwise replace the existing value).
        created_at: existing.created_at,
      };
      await updateTournament(merged);
    }
    if (body.entries) {
      await replaceEntriesFor(params.id, body.entries.map((e: any) => ({
        player_id: e.player_id,
        buy_ins: Number(e.buy_ins) || 1,
        finish_position: e.finish_position == null || e.finish_position === "" ? null : Number(e.finish_position),
        payout_override: e.payout_override == null || e.payout_override === "" ? null : Number(e.payout_override),
      })));
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed to save tournament";
    const status = msg === "location_id is required" || msg.startsWith("payout_structure") ? 400 : 500;
    const error = msg === "location_id is required" ? "Location is required" : msg;
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteTournament(params.id);
  return NextResponse.json({ ok: true });
}
