"use client";
import { useEffect, useState } from "react";
import type { Player } from "@/lib/types";

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const r = await fetch("/api/players"); setPlayers(await r.json()); setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch("/api/players", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    setName(""); refresh();
  }
  async function del(id: string) {
    if (!confirm("Delete this player? Their tournament entries will remain.")) return;
    await fetch("/api/players", { method: "DELETE", body: JSON.stringify({ id }) });
    refresh();
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
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td><button onClick={() => del(p.id)} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
