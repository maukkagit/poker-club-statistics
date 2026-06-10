import { listLocations, createLocation, updateLocationName } from "@/lib/db";
import { jsonOk, jsonError, handleDbError } from "@/lib/http/route-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk(await listLocations());
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return jsonError("name is required", 400);
  }
  try {
    return jsonOk(await createLocation(name));
  } catch (e) {
    return handleDbError(e, "Failed to create location");
  }
}

export async function PATCH(req: Request) {
  const { id, name } = await req.json();
  if (!id || typeof id !== "string") {
    return jsonError("id is required", 400);
  }
  if (typeof name !== "string" || !name.trim()) {
    return jsonError("name is required", 400);
  }
  try {
    return jsonOk(await updateLocationName(id, name));
  } catch (e) {
    return handleDbError(e, "Failed to update location");
  }
}
