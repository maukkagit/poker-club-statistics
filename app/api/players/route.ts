import { NextResponse } from "next/server";
import { listPlayers, createPlayer, deletePlayer } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listPlayers());
}
export async function POST(req: Request) {
  const { name } = await req.json();
  return NextResponse.json(await createPlayer(String(name ?? "")));
}
export async function DELETE(req: Request) {
  const { id } = await req.json();
  await deletePlayer(String(id));
  return NextResponse.json({ ok: true });
}
