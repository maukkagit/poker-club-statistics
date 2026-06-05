"use client";
import { useEffect, useMemo, useState } from "react";
import type { Player, PayoutSlot } from "@/lib/types";

export type EntryDraft = {
  id?: string;
  player_id: string;
  buy_ins: number;
  finish_position: number | null;
  payout_override: number | null;
};

export type TournamentDraft = {
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  notes?: string;
};

function computePayouts(pool: number, structure: PayoutSlot[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of structure) m.set(s.position, (s.pct / 100) * pool);
  return m;
}

export default function TournamentEditor({
  initialTournament, initialEntries, mode, onSubmit, onDelete, onCancel,
}: {
  initialTournament?: TournamentDraft;
  initialEntries?: EntryDraft[];
  mode: "create" | "edit";
  onSubmit: (t: TournamentDraft, entries: EntryDraft[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [t, setT] = useState<TournamentDraft>(initialTournament ?? {
    date: new Date().toISOString().slice(0, 10),
    name: `Tournament ${new Date().toLocaleDateString()}`,
    buy_in_amount: 10,
    payout_structure: [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }],
    notes: "",
  });
  const [players, setPlayers] = useState<Player[]>([]);
  const [entries, setEntries] = useState<EntryDraft[]>(initialEntries ?? []);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [pickPlayer, setPickPlayer] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refreshPlayers() {
    const r = await fetch("/api/players"); setPlayers(await r.json());
  }
  useEffect(() => { refreshPlayers(); }, []);

  const payoutSum = t.payout_structure.reduce((s, x) => s + x.pct, 0);
  const totalPool = entries.reduce((s, e) => s + (Number(e.buy_ins) || 0) * t.buy_in_amount, 0);
  const computed = useMemo(() => computePayouts(totalPool, t.payout_structure), [totalPool, t.payout_structure]);

  const overrideTotal = entries.reduce((s, e) => s + (e.payout_override ?? 0), 0);
  const hasOverrides = entries.some(e => e.payout_override != null);
  const computedFromPos = entries.reduce((s, e) => s + (e.finish_position != null ? (computed.get(e.finish_position) ?? 0) : 0), 0);
  const payoutsAwarded = hasOverrides ? overrideTotal + computedFromPos * 0 + entries.filter(e => e.payout_override == null && e.finish_position != null).reduce((s, e) => s + (computed.get(e.finish_position!) ?? 0), 0)
                                       : computedFromPos;
  const remaining = totalPool - payoutsAwarded;

  function setSlot(idx: number, patch: Partial<PayoutSlot>) {
    setT(prev => ({ ...prev, payout_structure: prev.payout_structure.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }
  function addSlot() {
    setT(prev => ({ ...prev, payout_structure: [...prev.payout_structure, { position: prev.payout_structure.length + 1, pct: 0 }] }));
  }
  function removeSlot(idx: number) {
    setT(prev => ({ ...prev, payout_structure: prev.payout_structure.filter((_, i) => i !== idx) }));
  }

  function addEntry(player_id: string) {
    if (!player_id) return;
    if (entries.some(e => e.player_id === player_id)) return;
    setEntries(es => [...es, { player_id, buy_ins: 1, finish_position: null, payout_override: null }]);
    setPickPlayer("");
  }
  function patchEntry(idx: number, patch: Partial<EntryDraft>) {
    setEntries(es => es.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }
  function removeEntry(idx: number) {
    setEntries(es => es.filter((_, i) => i !== idx));
  }

  async function createNewPlayer() {
    if (!newPlayerName.trim()) return;
    const r = await fetch("/api/players", { method: "POST", body: JSON.stringify({ name: newPlayerName.trim() }) });
    const p: Player = await r.json();
    setNewPlayerName("");
    await refreshPlayers();
    addEntry(p.id);
  }

  async function save() {
    setErr(null);
    if (Math.abs(payoutSum - 100) > 0.01) { setErr(`Payout structure must sum to 100% (currently ${payoutSum}%)`); return; }
    if (entries.length < 2) { setErr("Add at least 2 players."); return; }
    setSaving(true);
    try { await onSubmit(t, entries); }
    catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setSaving(false); }
  }

  const playerOptions = players.filter(p => !entries.some(e => e.player_id === p.id));

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 md:grid-cols-4 gap-3">
        <div><label className="label">Date</label><input className="input" type="date" value={t.date} onChange={e => setT({ ...t, date: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">Name</label><input className="input" value={t.name} onChange={e => setT({ ...t, name: e.target.value })} /></div>
        <div><label className="label">Buy-in (€)</label><input className="input" type="number" min={1} value={t.buy_in_amount} onChange={e => setT({ ...t, buy_in_amount: Number(e.target.value) })} /></div>
        <div className="md:col-span-4"><label className="label">Notes</label><input className="input" value={t.notes ?? ""} onChange={e => setT({ ...t, notes: e.target.value })} /></div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Payout structure</h2>
          <div className={`text-sm ${Math.abs(payoutSum - 100) > 0.01 ? "neg" : "muted"}`}>Sum: {payoutSum}%</div>
        </div>
        <div className="space-y-2">
          {t.payout_structure.map((s, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="muted text-sm w-16">Position</span>
              <input className="input w-20" type="number" min={1} value={s.position} onChange={e => setSlot(i, { position: Number(e.target.value) })} />
              <input className="input w-24" type="number" min={0} step="0.01" value={s.pct} onChange={e => setSlot(i, { pct: Number(e.target.value) })} />
              <span className="muted">%</span>
              <span className="muted text-sm ml-auto">= €{(computed.get(s.position) ?? 0).toFixed(2)}</span>
              <button onClick={() => removeSlot(i)} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]">Remove</button>
            </div>
          ))}
          <button onClick={addSlot} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]">+ Add place</button>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Players</h2>
        <div className="flex flex-wrap gap-2 mb-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Add existing</label>
            <select className="select" value={pickPlayer} onChange={e => { addEntry(e.target.value); }}>
              <option value="">— select —</option>
              {playerOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label">Or create new</label>
            <div className="flex gap-2">
              <input className="input" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} placeholder="New player name" />
              <button onClick={createNewPlayer} className="btn" disabled={!newPlayerName.trim()}>+ Add</button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th><th>Buy-ins</th><th>Cost</th><th>Finish</th>
                <th>Computed payout</th><th>Override (€)</th><th>Net</th><th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const p = players.find(p => p.id === e.player_id);
                const cost = (Number(e.buy_ins) || 0) * t.buy_in_amount;
                const compP = e.finish_position != null ? (computed.get(e.finish_position) ?? 0) : 0;
                const payout = e.payout_override != null ? e.payout_override : compP;
                const net = payout - cost;
                return (
                  <tr key={i}>
                    <td>{p?.name ?? <span className="muted">unknown</span>}</td>
                    <td><input className="input w-20" type="number" min={1} value={e.buy_ins} onChange={ev => patchEntry(i, { buy_ins: Number(ev.target.value) })} /></td>
                    <td>€{cost.toFixed(2)}</td>
                    <td><input className="input w-20" type="number" min={1} value={e.finish_position ?? ""} onChange={ev => patchEntry(i, { finish_position: ev.target.value === "" ? null : Number(ev.target.value) })} /></td>
                    <td className="muted">€{compP.toFixed(2)}</td>
                    <td><input className="input w-24" type="number" step="0.01" value={e.payout_override ?? ""} placeholder="—" onChange={ev => patchEntry(i, { payout_override: ev.target.value === "" ? null : Number(ev.target.value) })} /></td>
                    <td className={net >= 0 ? "pos" : "neg"}>€{net.toFixed(2)}</td>
                    <td><button onClick={() => removeEntry(i)} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]">Remove</button></td>
                  </tr>
                );
              })}
              {entries.length === 0 && <tr><td colSpan={8} className="muted">No players yet.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td className="muted">Totals</td>
                <td className="muted">{entries.reduce((s, e) => s + Number(e.buy_ins || 0), 0)}</td>
                <td className="muted">€{totalPool.toFixed(2)} pool</td>
                <td></td>
                <td className="muted">Awarded: €{payoutsAwarded.toFixed(2)}</td>
                <td className={Math.abs(remaining) < 0.01 ? "muted" : "neg"}>Remaining: €{remaining.toFixed(2)}</td>
                <td></td><td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {err && <div className="card neg">{err}</div>}

      <div className="flex gap-2 flex-wrap">
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create tournament" : "Save changes"}</button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        )}
        {onDelete && (
          <button className="btn-danger px-3 py-2 rounded font-semibold ml-auto" onClick={async () => {
            if (!confirm("Delete this tournament and all its entries?")) return;
            await onDelete();
          }}>Delete tournament</button>
        )}
      </div>
    </div>
  );
}
