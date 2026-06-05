import { NextResponse } from "next/server";
import { listTournaments, createTournament, replaceEntriesFor } from "@/lib/sheets";
import type { Tournament } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listTournaments());
}

export async function POST(req: Request) {
  const body = await req.json() as Omit<Tournament, "id"> & { entries?: { player_id: string; buy_ins: number; finish_position: number | null; payout_override: number | null }[] };
  const t = await createTournament({
    date: body.date, name: body.name, buy_in_amount: Number(body.buy_in_amount),
    payout_structure: body.payout_structure, notes: body.notes ?? "",
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
}
