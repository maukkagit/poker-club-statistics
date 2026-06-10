import { describe, it, expect } from "vitest";

// Baseline contract for the formatters currently duplicated inline across the
// app (app/page.tsx, app/face-off/page.tsx, app/players/[id]/page.tsx, ...).
// The reference implementations below are copied verbatim from the current
// code. When lib/format.ts is introduced (#37), replace these locals with
// imports from "@/lib/format" — the expectations must stay identical, proving
// the shared module preserves behavior.

const eur = (n: number) => `€${n.toFixed(2)}`;
const eurSigned = (n: number) => `${n >= 0 ? "+" : ""}€${n.toFixed(2)}`;
const eurRounded = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;
const oneDecimal = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

describe("formatter baseline contract", () => {
  it("eur renders €x.xx", () => {
    expect(eur(0)).toBe("€0.00");
    expect(eur(1234.5)).toBe("€1234.50");
    expect(eur(-60)).toBe("€-60.00");
  });

  it("eurSigned prefixes a + for non-negative values only", () => {
    expect(eurSigned(0)).toBe("+€0.00");
    expect(eurSigned(252)).toBe("+€252.00");
    expect(eurSigned(-30)).toBe("€-30.00");
  });

  it("eurRounded rounds and groups thousands", () => {
    expect(eurRounded(360)).toBe("€360");
    expect(eurRounded(1234.5)).toBe("€1,235");
  });

  it("oneDecimal keeps exactly one fraction digit", () => {
    expect(oneDecimal(2.2)).toBe("2.2");
    expect(oneDecimal(33.34)).toBe("33.3");
  });

  it("ordinal handles the 11-13 teens specially", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
  });
});
