import { describe, it, expect } from "vitest";
import { colorForIndex } from "../lib/chartColors";

describe("colorForIndex", () => {
  it("produces stable golden-ratio hues with interleaved L/S bands", () => {
    const first8 = Array.from({ length: 8 }, (_, i) => colorForIndex(i));
    expect(first8).toEqual([
      "hsl(0.0 68% 45%)",
      "hsl(137.5 92% 72%)",
      "hsl(275.0 80% 90%)",
      "hsl(52.5 68% 55%)",
      "hsl(190.0 92% 78%)",
      "hsl(327.5 80% 45%)",
      "hsl(105.0 68% 72%)",
      "hsl(242.6 92% 90%)",
    ]);
  });

  it("wraps hue modulo 360 and bands by index", () => {
    expect(colorForIndex(15)).toBe(colorForIndex(15));
    const c = colorForIndex(15);
    expect(c).toMatch(/^hsl\(\d+(\.\d+)? \d+% \d+%\)$/);
  });
});
