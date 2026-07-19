import { NextResponse } from "next/server";
import {
  listTournaments, createTournament, replaceEntriesFor, listEntries, listPlayers, listLocations,
  computeTournamentOrderNumbers, displayTournamentName,
} from "@/lib/db";
import type { Tournament } from "@/lib/types";
import { parseSpecialFlag, handleDbError } from "@/lib/http/route-helpers";

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
  const addonsByT = new Map<string, number>();
  for (const e of entries) {
    if (e.finish_position === 1) {
      winnerByT.set(e.tournament_id, playerNameById.get(e.player_id) ?? null);
    }
    if (!playersByT.has(e.tournament_id)) playersByT.set(e.tournament_id, new Set());
    playersByT.get(e.tournament_id)!.add(e.player_id);
    buyInsByT.set(e.tournament_id, (buyInsByT.get(e.tournament_id) ?? 0) + e.buy_ins);
    addonsByT.set(e.tournament_id, (addonsByT.get(e.tournament_id) ?? 0) + (e.addons ?? 0));
  }
  const enriched = tournaments.map(t => {
    const order_number = orderById.get(t.id) ?? null;
    return {
      ...t,
      order_number,
      display_name: displayTournamentName({ name: t.name, order_number, state: t.state }),
      winner_name: winnerByT.get(t.id) ?? null,
      player_count: playersByT.get(t.id)?.size ?? 0,
      // Exposed so consumers can fold in PKO bounty money (per buy-in, not
      // per add-on) without back-calculating it from `prize_pool`.
      total_buy_ins: buyInsByT.get(t.id) ?? 0,
      // Add-ons fund the regular pool only (never a fresh PKO bounty), same
      // treatment as `buy_in_amount` on a rebuy.
      prize_pool: (buyInsByT.get(t.id) ?? 0) * t.buy_in_amount + (addonsByT.get(t.id) ?? 0) * (t.addon_price ?? 0),
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
    const special = parseSpecialFlag((body as { special?: unknown }).special);
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
        addons: 0,
        finish_position: e.finish_position == null || e.finish_position === undefined ? null : Number(e.finish_position),
        payout_override: e.payout_override == null ? null : Number(e.payout_override),
      })));
    }
    return NextResponse.json(t);
  } catch (e) {
    // The location guard throws "location_id is required"; handleDbError
    // surfaces a friendlier sentence while keeping the same 400 status code.
    return handleDbError(e, "Failed to create tournament");
  }
}
