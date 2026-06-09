import { NextResponse } from "next/server";
import { listLocations, createLocation, updateLocationName } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listLocations());
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const created = await createLocation(name);
    return NextResponse.json(created);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to create location" }, { status: 500 });
  }
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
    const updated = await updateLocationName(id, name);
    return NextResponse.json(updated);
  } catch (e: any) {
    const msg = e?.message ?? "Failed to update location";
    const status = msg.startsWith("Location not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
