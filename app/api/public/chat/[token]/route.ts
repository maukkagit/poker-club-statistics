import { NextResponse } from "next/server";
import {
  getTournamentByShareToken, listChatMessages, addChatMessage, setPinnedChatMessage,
} from "@/lib/db";
import { checkPassword } from "@/lib/auth";
import { broadcastChatChanged } from "@/lib/realtime";
import { validateChatInput, clampText, CHAT_NAME_MAX, CHAT_BODY_MAX } from "@/lib/chat";
import type { ChatMessage, PublicChat, PublicChatMessage } from "@/lib/types";

// Public, unauthenticated tournament chat behind the share token. Excluded from
// the auth gate in middleware.ts (see the `api/public/` matcher). Anyone with
// the viewer link can read the feed and — until the tournament is Finished —
// post messages. Pinning a message requires the site password.
export const dynamic = "force-dynamic";

/** Strip the internal tournament id from a row before sending it to viewers. */
function toPublic(m: ChatMessage): PublicChatMessage {
  return { id: m.id, author_name: m.author_name, body: m.body, pinned: m.pinned, system: m.system, created_at: m.created_at };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const t = await getTournamentByShareToken(params.token);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = await listChatMessages(t.id);
  const payload: PublicChat = {
    open: t.state !== "Finished",
    messages: messages.map(toPublic),
  };
  return NextResponse.json(payload);
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const t = await getTournamentByShareToken(params.token);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "send") {
    if (t.state === "Finished") {
      return NextResponse.json({ error: "Chat is closed — this tournament has finished." }, { status: 403 });
    }
    const input = { name: String(body?.author_name ?? ""), body: String(body?.body ?? "") };
    const err = validateChatInput(input);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const message = await addChatMessage(
      t.id, clampText(input.name, CHAT_NAME_MAX), clampText(input.body, CHAT_BODY_MAX),
    );
    await broadcastChatChanged(params.token);
    return NextResponse.json(toPublic(message), { status: 201 });
  }

  if (action === "pin") {
    if (!checkPassword(String(body?.password ?? ""))) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    const messageId = body?.message_id == null ? null : String(body.message_id);
    await setPinnedChatMessage(t.id, messageId);
    await broadcastChatChanged(params.token);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
