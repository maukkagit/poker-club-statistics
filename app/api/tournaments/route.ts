import { NextResponse } from "next/server";
import {
  listTournaments, createTournament, replaceEntriesFor, listEntries, listPlayers, listLocations,
  computeTournamentOrderNumbers, displayTournamentName,
} from "@/lib/sheets";
import type { Tournament } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  // Enrich each tournament with per-tournament stats (winner, prize pool,
  // player count, location name) so the list view doesn't need a second
  // round-trip from the client. Aggregate top-level metrics live on
  // /api/stats instead.
  const [tournaments, entries, players, locations] = await Promise.all([
    listTournaments(), listEntries(), listPlayers(), listLocations(),
  ]);
  const playerNameById = new Map(players.map(p => [p.id, p.name]));
  const locationNameById = new Map(locations.map(l => [l.id, l.name]));
  // Chronological 1-indexed order number per tournament so the list view
  // (and any consumer) can show "Tournament #34" when the user-supplied
  // name is blank.
  const orderById = computeTournamentOrderNumbers(tournaments);
  const winnerByT = new Map<string, string | null>();
  const playersByT = new Map<string, Set<string>>();
  const buyInsByT = new Map<string, number>();
  for (const e of entries) {
    if (e.finish_position === 1) {
      winnerByT.set(e.tournament_id, playerNameById.get(e.player_id) ?? null);
    }
    if (!playersByT.has(e.tournament_id)) playersByT.set(e.tournament_id, new Set());
    playersByT.get(e.tournament_id)!.add(e.player_id);
    buyInsByT.set(e.tournament_id, (buyInsByT.get(e.tournament_id) ?? 0) + e.buy_ins);
  }
  const enriched = tournaments.map(t => {
    const order_number = orderById.get(t.id) ?? null;
    return {
      ...t,
      order_number,
      display_name: displayTournamentName({ name: t.name, order_number, state: t.state }),
      winner_name: winnerByT.get(t.id) ?? null,
      player_count: playersByT.get(t.id)?.size ?? 0,
      prize_pool: (buyInsByT.get(t.id) ?? 0) * t.buy_in_amount,
      location_name: t.location_id ? (locationNameById.get(t.location_id) ?? null) : null,
    };
  });
  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const body = await req.json() as Omit<Tournament, "id"> & { entries?: { player_id: string; buy_ins: number; finish_position: number | null; payout_override: number | null }[] };
  try {
    // `state` defaults to "Finished" in createTournament — the only path
    // that sends "Active" is the "Start tournament" flow. Anything else
    // (legacy API clients, migration scripts) keeps the historic behaviour.
    const state = body.state === "Active" ? "Active" : "Finished";
    // `special` is an explicit opt-in. Accept the strict boolean form the
    // editor sends, plus the looser strings ("true"/"1") that a script
    // talking to this endpoint might use. Anything else (including
    // undefined) falls back to false.
    const rawSpecial: unknown = (body as { special?: unknown }).special;
    const special = rawSpecial === true || rawSpecial === "true" || rawSpecial === 1 || rawSpecial === "1";
    const t = await createTournament({
      date: body.date, name: (body.name ?? "").trim(), buy_in_amount: Number(body.buy_in_amount),
      payout_structure: body.payout_structure, notes: body.notes ?? "",
      location_id: body.location_id ?? null,
      state,
      special,
    });
    if (body.entries?.length) {
      await replaceEntriesFor(t.id, body.entries.map(e => ({
        player_id: e.player_id,
        buy_ins: Number(e.buy_ins) || 1,
        finish_position: e.finish_position == null || e.finish_position === undefined ? null : Number(e.finish_position),
        payout_override: e.payout_override == null ? null : Number(e.payout_override),
      })));
    }
    return NextResponse.json(t);
  } catch (e: any) {
    const msg = e?.message ?? "Failed to create tournament";
    // The location guard throws "location_id is required"; surface a friendlier
    // sentence to the client but keep the same 400 status code.
    const status = msg === "location_id is required" || msg.startsWith("payout_structure") ? 400 : 500;
    const error = msg === "location_id is required" ? "Location is required" : msg;
    return NextResponse.json({ error }, { status });
  }
}
