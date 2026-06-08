import { NextResponse } from "next/server";
import { deleteLocation } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await deleteLocation(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed to delete location";
    // `deleteLocation` throws when a tournament still references the row;
    // surface that as a 409 Conflict so the UI can show the message verbatim.
    const status = msg.startsWith("Cannot delete") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
