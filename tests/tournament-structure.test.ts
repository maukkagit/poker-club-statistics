import { describe, it, expect } from "vitest";
import {
  defaultStructure, levelCount, validateStructure, emptyLevelDraft,
} from "@/lib/tournament-structure";
import type { StructureRow } from "@/lib/types";

describe("defaultStructure", () => {
  it("starts empty so the wizard opens on a build-from-scratch ladder", () => {
    expect(defaultStructure()).toEqual([]);
  });
});

describe("levelCount", () => {
  it("counts only level rows", () => {
    const s: StructureRow[] = [
      { kind: "level", sb: 1, bb: 2, ante: 0, duration_min: 20 },
      { kind: "break", duration_min: 10 },
      { kind: "level", sb: 2, bb: 4, ante: 0, duration_min: 20 },
    ];
    expect(levelCount(s)).toBe(2);
  });
});

describe("validateStructure", () => {
  it("rejects an empty structure", () => {
    expect(validateStructure([])).toMatch(/at least one/i);
  });
  it("rejects a break-only structure", () => {
    expect(validateStructure([{ kind: "break", duration_min: 10 }])).toMatch(/at least one blind/i);
  });
  it("rejects a non-positive duration", () => {
    expect(validateStructure([{ kind: "level", sb: 1, bb: 2, ante: 0, duration_min: 0 }]))
      .toMatch(/duration/i);
  });
  it("rejects bb smaller than sb", () => {
    expect(validateStructure([{ kind: "level", sb: 200, bb: 100, ante: 0, duration_min: 20 }]))
      .toMatch(/big blind/i);
  });
  it("accepts a valid single level", () => {
    expect(validateStructure([{ kind: "level", sb: 100, bb: 200, ante: 0, duration_min: 20 }]))
      .toBeNull();
  });
});

describe("emptyLevelDraft", () => {
  it("is a blank level (all zeros) for manual entry", () => {
    expect(emptyLevelDraft()).toEqual({ kind: "level", sb: 0, bb: 0, ante: 0, duration_min: 0 });
  });
  it("is invalid until filled in (blocks half-built saves)", () => {
    expect(validateStructure([emptyLevelDraft()])).not.toBeNull();
  });
});
