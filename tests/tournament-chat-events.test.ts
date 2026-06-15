import { describe, it, expect } from "vitest";
import {
  TD_AUTHOR, rebuyMessage, securedMessage, wonMessage, bustedMessage, bustMessages,
} from "@/lib/tournament-chat-events";

describe("tournament-chat-events", () => {
  it("authors announcements as TD", () => {
    expect(TD_AUTHOR).toBe("TD");
  });

  it("formats a re-entry line", () => {
    expect(rebuyMessage("Maukka")).toBe("Maukka busted out & rebought back in!");
  });

  it("formats a plain bust line", () => {
    expect(bustedMessage("Maukka")).toBe("Maukka busted out!");
  });

  it("formats paid bust-out lines with ordinals", () => {
    expect(securedMessage("Maukka", 3)).toBe("Maukka busted out on 3rd place!");
    expect(securedMessage("Ann", 2)).toBe("Ann busted out on 2nd place!");
  });

  it("formats the champion line", () => {
    expect(wonMessage("Ann")).toBe("Ann has won the tournament!");
  });

  it("announces a non-paid bust as 'busted out'", () => {
    expect(bustMessages({ bustedName: "Bo", bustedFinish: 14, paidPositions: new Set([1, 2, 3]) }))
      .toEqual(["Bo busted out!"]);
  });

  it("announces a paid bust as 'busted out on Nth place'", () => {
    expect(bustMessages({ bustedName: "Bo", bustedFinish: 3, paidPositions: new Set([1, 2, 3]) }))
      .toEqual(["Bo busted out on 3rd place!"]);
  });

  it("falls back to 'busted out' when the finish is unknown", () => {
    expect(bustMessages({ bustedName: "Bo", bustedFinish: null, paidPositions: new Set([1]) }))
      .toEqual(["Bo busted out!"]);
  });

  it("appends the champion's secured-place line when the bust crowns a winner", () => {
    expect(bustMessages({
      bustedName: "Runner",
      bustedFinish: 2,
      paidPositions: new Set([1, 2, 3]),
      champion: { name: "Champ", finish: 1 },
    })).toEqual([
      "Runner busted out on 2nd place!",
      "Champ has won the tournament!",
    ]);
  });
});
