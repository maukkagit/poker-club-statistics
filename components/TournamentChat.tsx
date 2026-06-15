"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { apiKeys, ApiError } from "@/lib/api";
import { useChatChannel } from "@/components/useChatChannel";
import { validateChatInput, CHAT_NAME_MAX, CHAT_BODY_MAX } from "@/lib/chat";
import type { PublicChat, PublicChatMessage } from "@/lib/types";

const NAME_KEY = "pc_chat_name";

/**
 * Public, live-stream-style tournament chat for the viewer link. Anyone with
 * the share token can read the feed and — while the tournament is open — post
 * under a self-chosen display name (remembered in localStorage). Exactly one
 * message can be pinned at a time; pinning/unpinning asks for the site password.
 * Polls the public endpoint and also subscribes to the realtime chat channel
 * so new messages appear within a fraction of a second.
 */
export default function TournamentChat({ token }: { token: string }) {
  const key = token ? apiKeys.publicChat(token) : null;
  const { data, error, mutate } = useSWR<PublicChat>(key, { refreshInterval: 5000 });
  const refetch = useCallback(() => { void mutate(); }, [mutate]);
  useChatChannel(token, refetch);

  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // null = modal closed; otherwise the message id to pin (or null id = unpin).
  const [pinTarget, setPinTarget] = useState<{ id: string | null } | null>(null);

  // Restore the saved display name on mount (client-only, avoids SSR mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY) ?? "";
      if (saved) setName(saved);
      else setEditingName(true);
    } catch { /* localStorage unavailable */ }
  }, []);

  const messages = data?.messages ?? [];
  const pinned = messages.find(m => m.pinned) ?? null;
  const open = data?.open ?? false;

  // Auto-scroll the feed to the newest message when the count grows.
  const feedRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (messages.length > prevCount.current) el.scrollTop = el.scrollHeight;
    prevCount.current = messages.length;
  }, [messages.length]);

  function saveName() {
    const n = nameDraft.trim().slice(0, CHAT_NAME_MAX);
    if (!n) return;
    setName(n);
    setEditingName(false);
    try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
  }

  async function send() {
    const validation = validateChatInput({ name, body: draft });
    if (validation) { setErr(validation); return; }
    setErr(null);
    setSending(true);
    const optimistic: PublicChatMessage = {
      id: `tmp-${Date.now()}`,
      author_name: name,
      body: draft.trim(),
      pinned: false,
      system: false,
      created_at: new Date().toISOString(),
    };
    void mutate(prev => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev), { revalidate: false });
    setDraft("");
    try {
      const res = await fetch(apiKeys.publicChat(token), {
        method: "POST",
        body: JSON.stringify({ action: "send", author_name: name, body: optimistic.body }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new ApiError(b?.error ?? "Failed to send", res.status, b);
      }
      void mutate();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to send message.");
      void mutate();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card flex flex-col" style={{ maxHeight: "32rem" }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold">Tournament chat</h2>
        {name && !editingName && (
          <span className="text-xs muted truncate">
            Chatting as <span className="font-semibold">{name}</span>{" "}
            <button className="link" onClick={() => { setNameDraft(name); setEditingName(true); }}>change</button>
          </span>
        )}
      </div>

      {pinned && (
        <div
          className="rounded-lg px-3 py-2 mb-3 shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.65rem] uppercase tracking-wide font-semibold" style={{ color: "var(--accent)" }}>Pinned</span>
            <button className="link text-xs" onClick={() => setPinTarget({ id: null })}>Unpin</button>
          </div>
          <div className="text-sm break-words">
            <span className="font-semibold">{pinned.author_name}</span>
            <span>: {pinned.body}</span>
          </div>
        </div>
      )}

      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto space-y-1.5 p-2.5 min-h-0 rounded-lg"
        style={{ border: "1px solid var(--border)", background: "var(--bg)" }}
      >
        {error ? (
          <div className="muted text-sm">Couldn&apos;t load the chat.</div>
        ) : messages.length === 0 ? (
          <div className="muted text-sm">No messages yet. Say hello!</div>
        ) : (
          messages.map(m => (
            <div key={m.id} className="group flex items-start gap-2 text-sm">
              <div
                className={`min-w-0 flex-1 break-words${m.system ? " font-bold" : ""}`}
                style={m.system ? { color: "var(--accent)" } : undefined}
              >
                <span className="font-semibold">{m.author_name}</span>
                <span>: {m.body}</span>
                <span className="muted text-xs ml-2 whitespace-nowrap">{shortTime(m.created_at)}</span>
              </div>
              {!String(m.id).startsWith("tmp-") && (
                <button
                  className="link text-xs opacity-60 hover:opacity-100 shrink-0"
                  title="Pin this message (requires the site password)"
                  onClick={() => setPinTarget({ id: m.id })}
                >
                  {m.pinned ? "Pinned" : "Pin"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {err && <div className="text-xs neg mt-2">{err}</div>}

      <div className="mt-3 shrink-0">
        {!open ? (
          <p className="muted text-sm">Chat is closed — this tournament has finished.</p>
        ) : editingName || !name ? (
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={nameDraft}
              maxLength={CHAT_NAME_MAX}
              placeholder="Enter your name to chat…"
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveName(); }}
              autoFocus
            />
            <button className="btn" disabled={!nameDraft.trim()} onClick={saveName}>Join chat</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={draft}
              maxLength={CHAT_BODY_MAX}
              placeholder="Type a message…"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            />
            <button className="btn" disabled={sending || !draft.trim()} onClick={() => void send()}>Send</button>
          </div>
        )}
      </div>

      {pinTarget && (
        <PinDialog
          token={token}
          messageId={pinTarget.id}
          onClose={() => setPinTarget(null)}
          onDone={() => { setPinTarget(null); void mutate(); }}
        />
      )}
    </div>
  );
}

/**
 * Password-gated pin/unpin prompt. Submits the site password alongside the
 * target message id (null = unpin). Surfaces a wrong-password error inline.
 */
function PinDialog({
  token, messageId, onClose, onDone,
}: {
  token: string;
  messageId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unpin = messageId === null;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiKeys.publicChat(token), {
        method: "POST",
        body: JSON.stringify({ action: "pin", message_id: messageId, password }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new ApiError(b?.error ?? "Failed", res.status, b);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl shadow-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold mb-1">{unpin ? "Unpin message" : "Pin message"}</h2>
        <p className="muted text-sm mb-3">Enter the site password to {unpin ? "unpin" : "pin"} this message for everyone.</p>
        <input
          className="input"
          type="password"
          value={password}
          placeholder="Site password"
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void submit(); }}
          autoFocus
        />
        {err && <div className="text-xs neg mt-2">{err}</div>}
        <div className="flex gap-2 mt-4">
          <button className="btn" disabled={busy || !password} onClick={() => void submit()}>
            {unpin ? "Unpin" : "Pin"}
          </button>
          <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Short local clock time (HH:MM) for a message timestamp. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
