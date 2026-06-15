import { NextResponse } from "next/server";
import { createTournamentWithSeating, type CreateWithSeatingPayload } from "@/lib/db";
import { rpcErrorResponse } from "@/lib/http/rpc-errors";
import { parseStructure } from "@/lib/db/mappers";
import type { PayoutSlot, Seating } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * "Start a tournament" wizard confirm step. Creates the Active tournament, its
 * entries and (optionally) the seat assignment in a single atomic RPC. Nothing
 * is written until this endpoint is hit — the wizard holds everything in client
 * state up to Confirm.
 */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const entries: { player_id: string; bucket?: number | null }[] = Array.isArray(body.entries)
      ? body.entries.map((e: any) => ({
          player_id: String(e.player_id),
          bucket: e.bucket == null || e.bucket === "" ? null : Number(e.bucket),
        }))
      : [];
    if (entries.length < 2) {
      return NextResponse.json({ error: "Add at least 2 players." }, { status: 400 });
    }

    const payload: CreateWithSeatingPayload = {
      date: String(body.date),
      name: (body.name ?? "").trim(),
      buy_in_amount: Number(body.buy_in_amount),
      payout_structure: body.payout_structure as PayoutSlot[],
      notes: (body.notes ?? "").toString(),
      location_id: body.location_id,
      special: body.special === true || body.special === "true" || body.special === 1 || body.special === "1",
      rebuys_allowed: body.rebuys_allowed === false ? false : true,
      entries,
      seating: (body.seating ?? null) as Seating | null,
      assignments: Array.isArray(body.assignments)
        ? body.assignments.map((a: any) => ({
            player_id: String(a.player_id),
            table_no: Number(a.table_no),
            seat_no: Number(a.seat_no),
          }))
        : null,
      // Tournament clock structure (issue #21). Re-parsed defensively so a
      // malformed client payload can't persist junk rows.
      structure: parseStructure(body.structure),
      starting_stack: body.starting_stack == null || body.starting_stack === ""
        ? null
        : Number(body.starting_stack),
      // Progressive knockout (PKO) config.
      is_pko: body.is_pko === true || body.is_pko === "true",
      bounty_start_amount: body.bounty_start_amount == null || body.bounty_start_amount === ""
        ? 0
        : Number(body.bounty_start_amount),
      bounty_start_level: body.bounty_start_level == null || body.bounty_start_level === ""
        ? null
        : Number(body.bounty_start_level),
      bounty_chip: body.bounty_chip == null || body.bounty_chip === ""
        ? 2.5
        : Number(body.bounty_chip),
    };

    const id = await createTournamentWithSeating(payload);
    return NextResponse.json({ id });
  } catch (e) {
    const { status, error } = rpcErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }
}
