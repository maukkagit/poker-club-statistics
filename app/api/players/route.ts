import { NextResponse } from "next/server";
import { listPlayers, createPlayer, updatePlayerName } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listPlayers());
}
export async function POST(req: Request) {
  const { name } = await req.json();
  return NextResponse.json(await createPlayer(String(name ?? "")));
}
export async function PATCH(req: Request) {
  const { id, name } = await req.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const updated = await updatePlayerName(id, name);
    return NextResponse.json(updated);
  } catch (e: any) {
    const msg = e?.message ?? "Failed to update player";
    const status = msg.startsWith("Player not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
