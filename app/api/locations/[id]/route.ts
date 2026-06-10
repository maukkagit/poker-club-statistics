import { deleteLocation } from "@/lib/db";
import { jsonOk, handleDbError } from "@/lib/http/route-helpers";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await deleteLocation(params.id);
    return jsonOk({ ok: true });
  } catch (e) {
    // `deleteLocation` throws "Cannot delete" when a tournament still
    // references the row; handleDbError maps that to a 409 Conflict.
    return handleDbError(e, "Failed to delete location");
  }
}
