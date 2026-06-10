import { describe, it, expect } from "vitest";
import { parseIncludeSpecial, parseSpecialFlag, handleDbError } from "@/lib/http/route-helpers";

describe("parseIncludeSpecial", () => {
  it("is true only for '1' or 'true'", () => {
    expect(parseIncludeSpecial(new Request("http://x/?includeSpecial=1"))).toBe(true);
    expect(parseIncludeSpecial(new Request("http://x/?includeSpecial=true"))).toBe(true);
    expect(parseIncludeSpecial(new Request("http://x/?includeSpecial=0"))).toBe(false);
    expect(parseIncludeSpecial(new Request("http://x/"))).toBe(false);
  });
});

describe("parseSpecialFlag", () => {
  it("accepts the strict boolean plus loose true/1 forms", () => {
    for (const v of [true, "true", 1, "1"]) expect(parseSpecialFlag(v)).toBe(true);
    for (const v of [false, "false", 0, "0", undefined, null, "yes"]) expect(parseSpecialFlag(v)).toBe(false);
  });
});

describe("handleDbError", () => {
  async function status(e: unknown, fallback?: string) {
    const res = handleDbError(e, fallback);
    return { status: res.status, body: await res.json() };
  }

  it("maps the known data-layer errors to their status codes", async () => {
    expect(await status(new Error("location_id is required"))).toEqual({ status: 400, body: { error: "Location is required" } });
    expect(await status(new Error("payout_structure must sum to 100, got 90"))).toEqual({ status: 400, body: { error: "payout_structure must sum to 100, got 90" } });
    expect(await status(new Error("Player not found: x"))).toEqual({ status: 404, body: { error: "Player not found: x" } });
    expect(await status(new Error("Location not found: y"))).toEqual({ status: 404, body: { error: "Location not found: y" } });
    expect(await status(new Error("Cannot delete: 2 tournaments still use this location"))).toEqual({ status: 409, body: { error: "Cannot delete: 2 tournaments still use this location" } });
  });

  it("falls back to 500 with the message or the provided fallback", async () => {
    expect(await status(new Error("boom"))).toEqual({ status: 500, body: { error: "boom" } });
    expect(await status({}, "Failed to create tournament")).toEqual({ status: 500, body: { error: "Failed to create tournament" } });
  });
});
