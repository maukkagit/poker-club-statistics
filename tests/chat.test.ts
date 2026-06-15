import { describe, it, expect } from "vitest";
import { validateChatInput, clampText, CHAT_NAME_MAX, CHAT_BODY_MAX, RESERVED_CHAT_NAME } from "@/lib/chat";

describe("validateChatInput", () => {
  it("accepts a normal name + message", () => {
    expect(validateChatInput({ name: "Alice", body: "nh sir" })).toBeNull();
  });
  it("requires a name", () => {
    expect(validateChatInput({ name: "   ", body: "hi" })).toMatch(/name/i);
  });
  it("requires a body", () => {
    expect(validateChatInput({ name: "Bob", body: "  " })).toMatch(/message/i);
  });
  it("rejects an over-long name", () => {
    expect(validateChatInput({ name: "x".repeat(CHAT_NAME_MAX + 1), body: "hi" })).toMatch(/name/i);
  });
  it("rejects an over-long body", () => {
    expect(validateChatInput({ name: "Bob", body: "x".repeat(CHAT_BODY_MAX + 1) })).toMatch(/message/i);
  });
  it("rejects the reserved system name (case- and whitespace-insensitive)", () => {
    expect(validateChatInput({ name: RESERVED_CHAT_NAME, body: "hi" })).toMatch(/reserved/i);
    expect(validateChatInput({ name: `  ${RESERVED_CHAT_NAME.toLowerCase()}  `, body: "hi" })).toMatch(/reserved/i);
  });
});

describe("clampText", () => {
  it("trims and clamps to the max length", () => {
    expect(clampText("  hello  ", 10)).toBe("hello");
    expect(clampText("abcdef", 3)).toBe("abc");
  });
});
