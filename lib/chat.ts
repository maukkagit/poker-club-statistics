// Pure helpers for the tournament chat. No React, no IO — shared by the public
// API route (server-side validation) and the chat UI (disable Send while
// invalid). Unit-tested in tests/chat.test.ts.
import { TD_AUTHOR } from "@/lib/tournament-chat-events";

/** Max lengths kept deliberately small: this is a casual live chat, not a forum. */
export const CHAT_NAME_MAX = 40;
export const CHAT_BODY_MAX = 500;

/**
 * Display name reserved for the automated tournament-director announcements.
 * Viewers can't impersonate it (compared case-insensitively, ignoring
 * surrounding whitespace).
 */
export const RESERVED_CHAT_NAME = TD_AUTHOR;

export type ChatInput = { name: string; body: string };

/**
 * Validate a would-be chat message. Returns a human-readable error string, or
 * null when both the display name and body are acceptable. Trims first, so
 * whitespace-only input is rejected.
 */
export function validateChatInput(input: ChatInput): string | null {
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) return "Enter a name first.";
  if (name.length > CHAT_NAME_MAX) return `Name must be ${CHAT_NAME_MAX} characters or fewer.`;
  if (name.toLowerCase() === RESERVED_CHAT_NAME.trim().toLowerCase()) {
    return `“${RESERVED_CHAT_NAME}” is reserved for tournament announcements — pick another name.`;
  }
  if (!body) return "Type a message.";
  if (body.length > CHAT_BODY_MAX) return `Message must be ${CHAT_BODY_MAX} characters or fewer.`;
  return null;
}

/** Normalise (trim + clamp) a value to a max length; used before persisting. */
export function clampText(value: string, max: number): string {
  return value.trim().slice(0, max);
}
