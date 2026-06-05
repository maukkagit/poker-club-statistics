import { NextResponse } from "next/server";
import { getTournament, updateTournament, deleteTournament, listEntriesFor, replaceEntriesFor, computeEntries } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = await getTournament(params.id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const entries = await listEntriesFor(t.id);
  const computed = computeEntries(t, entries);
  return NextResponse.json({ tournament: t, entries: computed });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const existing = await getTournament(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (body.tournament) {
    await updateTournament({ ...existing, ...body.tournament, id: existing.id });
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
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteTournament(params.id);
  return NextResponse.json({ ok: true });
}
