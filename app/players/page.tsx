"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Player } from "@/lib/types";
import { apiKeys, invalidateAfterPlayerMutation } from "@/lib/api";

export default function PlayersPage() {
  const { data, isLoading } = useSWR<Player[]>(apiKeys.players);
  const players = data ?? [];
  const loading = isLoading && !data;
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus + select the edit input when entering edit mode so the user
  // can immediately start typing.
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setErr(null);
    const res = await fetch("/api/players", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    if (!res.ok) { setErr("Failed to add player"); return; }
    setName("");
    await invalidateAfterPlayerMutation();
  }

  function startEdit(p: Player) {
    setErr(null);
    setEditingId(p.id);
    setEditingName(p.name);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }
  async function saveEdit() {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) { setErr("Name can't be empty"); return; }
    setSavingId(editingId);
    setErr(null);
    try {
      const res = await fetch("/api/players", {
        method: "PATCH",
        body: JSON.stringify({ id: editingId, name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await invalidateAfterPlayerMutation();
      cancelEdit();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Players</h1>
      <form onSubmit={add} className="card flex gap-2 items-end">
        <div className="flex-1">
          <label className="label">Add player</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        </div>
        <button className="btn" disabled={!name.trim()}>Add</button>
      </form>
      {err && <div className="card neg">{err}</div>}
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {players.map(p => {
                const isEditing = editingId === p.id;
                const isSaving = savingId === p.id;
                return (
                  <tr key={p.id}>
                    <td>
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          className="input"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); void saveEdit(); }
                            else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          }}
                          disabled={isSaving}
                        />
                      ) : (
                        p.name
                      )}
                    </td>
                    <td className="muted whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={isSaving || !editingName.trim() || editingName.trim() === p.name}
                            className="btn text-xs px-2 py-1"
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
