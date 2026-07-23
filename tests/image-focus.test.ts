import { describe, expect, it } from "vitest";
import {
  clampFocus,
  DEFAULT_IMAGE_FOCUS,
  imageObjectPosition,
  normalizeFocus,
} from "@/lib/image-focus";

describe("clampFocus", () => {
  it("clamps into 0–100", () => {
    expect(clampFocus(-10)).toBe(0);
    expect(clampFocus(0)).toBe(0);
    expect(clampFocus(50)).toBe(50);
    expect(clampFocus(100)).toBe(100);
    expect(clampFocus(140)).toBe(100);
  });

  it("falls back to 50 for non-finite input", () => {
    expect(clampFocus(Number.NaN)).toBe(50);
    expect(clampFocus(Number.POSITIVE_INFINITY)).toBe(50);
  });
});

describe("normalizeFocus", () => {
  it("defaults missing values to center", () => {
    expect(normalizeFocus()).toEqual(DEFAULT_IMAGE_FOCUS);
    expect(normalizeFocus(null, null)).toEqual(DEFAULT_IMAGE_FOCUS);
    expect(normalizeFocus(20, null)).toEqual({ x: 20, y: 50 });
  });

  it("clamps out-of-range values", () => {
    expect(normalizeFocus(-5, 120)).toEqual({ x: 0, y: 100 });
  });
});

describe("imageObjectPosition", () => {
  it("formats CSS object-position percentages", () => {
    expect(imageObjectPosition(30, 70)).toBe("30% 70%");
    expect(imageObjectPosition(null, null)).toBe("50% 50%");
  });
});
