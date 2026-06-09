"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { Location, Player, PayoutSlot, TournamentState } from "@/lib/types";
import { apiKeys, invalidateAfterLocationMutation, invalidateAfterPlayerMutation } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import LocationCombobox from "@/components/LocationCombobox";
import NumberInput from "@/components/NumberInput";
import PlayerCombobox from "@/components/PlayerCombobox";

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
  // Optional FK into the Locations table. `null` / undefined means
  // "no location recorded" — legacy tournaments are saved this way.
  location_id?: string | null;
  // Off-format / themed events (charity nights, "NLH Showdown", etc.).
  // Excluded by default from the dashboard aggregates; the dashboard
  // toggle lets the user opt them back in.
  special?: boolean;
};

function computePayouts(pool: number, structure: PayoutSlot[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of structure) m.set(s.position, (s.pct / 100) * pool);
  return m;
}

export default function TournamentEditor({
  initialTournament, initialEntries, mode, state = "Finished", onSubmit, onFinish, onDelete, onCancel,
}: {
  initialTournament?: TournamentDraft;
  initialEntries?: EntryDraft[];
  mode: "create" | "edit";
  /**
   * Lifecycle state of the tournament being edited. Drives:
   * - "create" + "Active": simplified form (no per-player buy-ins / finish /
   *   override columns) — the user just declares who's playing tonight.
   * - "edit" + "Active": full form with a "Finish tournament" button alongside
   *   the regular "Save" so the user can flip the state on save.
   * - "Finished" in either mode: the historic full editor.
   * Default is "Finished" to preserve back-compat for any caller that
   * doesn't pass the prop.
   */
  state?: TournamentState;
  onSubmit: (t: TournamentDraft, entries: EntryDraft[]) => Promise<void>;
  /**
   * Optional secondary action used only when editing an Active tournament.
   * Renders a "Finish tournament" button that calls this handler. The caller
   * is responsible for sending `state: "Finished"` to the API so the
   * tournament moves into the stats. When omitted, the button isn't shown.
   */
  onFinish?: (t: TournamentDraft, entries: EntryDraft[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
}) {
  // Simplified mode = the brand-new "Start a tournament" flow. Hide every
  // per-player input that only makes sense once the night is in progress
  // (buy-ins, finish positions, payout overrides) so the start screen is a
  // single fast form: who's playing, how much is buy-in, what's the payout
  // split. The same fields become visible when the user later comes back to
  // edit the active tournament.
  const simplified = mode === "create" && state === "Active";
  const [t, setT] = useState<TournamentDraft>(initialTournament ?? {
    date: new Date().toISOString().slice(0, 10),
    // Tournament name is optional — leave it blank by default so the list
    // view falls back to "Tournament #N" unless the user actively names it.
    name: "",
    buy_in_amount: 30,
    payout_structure: [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }],
    notes: "",
    location_id: null,
    special: false,
  });
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const players = playersData ?? [];
  const { data: locationsData } = useSWR<Location[]>(apiKeys.locations);
  const locations = locationsData ?? [];
  const [entries, setEntries] = useState<EntryDraft[]>(initialEntries ?? []);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    await invalidateAfterPlayerMutation();
    addEntry(p.id);
  }

  // Intent picks which callback to hit. "save" is the default primary
  // action; "finish" is the secondary action shown only when editing an
  // Active tournament — it transitions the state to "Finished" on the
  // server. Validation is identical for both because finishing reuses the
  // same data integrity rules; the only difference is which callback runs.
  async function submit(intent: "save" | "finish") {
    setErr(null);
    if (!t.location_id) { setErr("Pick a location for this tournament."); return; }
    if (Math.abs(payoutSum - 100) > 0.01) { setErr(`Payout structure must sum to 100% (currently ${payoutSum}%)`); return; }
    if (entries.length < 2) { setErr("Add at least 2 players."); return; }
    setSaving(true);
    try {
      const handler = intent === "finish" && onFinish ? onFinish : onSubmit;
      await handler({ ...t, name: t.name.trim() }, entries);
    }
    catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setSaving(false); }
  }

  const playerOptions = players.filter(p => !entries.some(e => e.player_id === p.id));

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* `min-w-0` on every grid item prevents `min-width: auto` (the grid
            default) from expanding a column to fit the date input's
            min-content, which is what was making the date overflow on mobile. */}
        <div className="min-w-0"><label className="label">Date</label><input className="input" type="date" value={t.date} onChange={e => setT({ ...t, date: e.target.value })} /></div>
        <div className="min-w-0 md:col-span-2">
          <label className="label">Name <span className="muted font-normal">(optional)</span></label>
          <input
            className="input"
            value={t.name}
            onChange={e => setT({ ...t, name: e.target.value })}
            placeholder="Leave blank to use Tournament #N"
          />
        </div>
        <div className="min-w-0"><label className="label">Buy-in (€)</label><NumberInput className="input" value={t.buy_in_amount} onChange={n => setT({ ...t, buy_in_amount: n ?? 0 })} /></div>
        <div className="min-w-0 md:col-span-2">
          <label className="label">Location <span className="neg font-normal" aria-hidden>*</span></label>
          <LocationCombobox
            value={t.location_id ?? null}
            locations={locations}
            onChange={id => setT(prev => ({ ...prev, location_id: id }))}
            onCreate={async name => {
              const res = await fetch("/api/locations", { method: "POST", body: JSON.stringify({ name }) });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? "Failed to create location");
              }
              const created: Location = await res.json();
              // Refresh the locations SWR cache so any other open editor (or
              // the Locations admin tab) sees the new row immediately.
              await invalidateAfterLocationMutation();
              return created;
            }}
          />
        </div>
        <div className="min-w-0 md:col-span-2"><label className="label">Notes</label><input className="input" value={t.notes ?? ""} onChange={e => setT({ ...t, notes: e.target.value })} /></div>
        <div className="min-w-0 md:col-span-2">
          {/* Sits at the bottom of the metadata grid so it has visual room
              to breathe (it's a single short toggle, not a fully-formed
              field). The help text under the box mirrors the dashboard
              copy so the connection between the two is obvious. */}
          <span className="label">Type</span>
          <label className="flex items-center gap-2 cursor-pointer select-none py-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-400 cursor-pointer"
              checked={!!t.special}
              onChange={e => setT({ ...t, special: e.target.checked })}
            />
            <span className="text-sm">Special tournament</span>
          </label>
          <p className="muted text-xs leading-snug">
            Excluded from dashboard stats by default. Use for themed/charity events.
          </p>
        </div>
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
              <NumberInput className="input w-20" value={s.position} onChange={n => setSlot(i, { position: n ?? 1 })} />
              <NumberInput className="input w-24" allowDecimal value={s.pct} onChange={n => setSlot(i, { pct: n ?? 0 })} />
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
            <PlayerCombobox
              players={playerOptions}
              onSelect={id => addEntry(id)}
              placeholder={playerOptions.length === 0 ? "All players already added" : "Search players…"}
              disabled={playerOptions.length === 0}
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label">Or create new</label>
            <div className="flex gap-2 items-center">
              <input className="input" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} placeholder="New player name" />
              {/* `whitespace-nowrap shrink-0` keeps "+ Add" on one line and at
                  its natural width — without it the input was eating all the
                  flex space and the button text wrapped onto two lines. */}
              <button onClick={createNewPlayer} className="btn whitespace-nowrap shrink-0" disabled={!newPlayerName.trim()}>+ Add</button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                {/* The buy-in / finish / override columns are only relevant
                    once the tournament is actually being played. For the
                    "Start tournament" creation flow we hide them entirely
                    so the form is just "who's playing?" */}
                {!simplified && <>
                  <th>Buy-ins</th>
                  <th className="hidden md:table-cell">Cost</th>
                  <th>Finish</th>
                  <th className="hidden md:table-cell">Computed payout</th>
                  <th>Override (€)</th>
                  <th>Net</th>
                </>}
                <th></th>
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
                    {!simplified && <>
                      <td><NumberInput className="input w-16 md:w-20" value={e.buy_ins} onChange={n => patchEntry(i, { buy_ins: n ?? 1 })} /></td>
                      <td className="hidden md:table-cell">€{cost.toFixed(2)}</td>
                      <td><NumberInput className="input w-16 md:w-20" value={e.finish_position} emptyBlurBehavior="null" onChange={n => patchEntry(i, { finish_position: n })} /></td>
                      <td className="muted hidden md:table-cell">€{compP.toFixed(2)}</td>
                      <td><NumberInput className="input w-20 md:w-24" allowDecimal value={e.payout_override} emptyBlurBehavior="null" placeholder="—" onChange={n => patchEntry(i, { payout_override: n })} /></td>
                      <td className={net >= 0 ? "pos" : "neg"}>€{net.toFixed(2)}</td>
                    </>}
                    <td>
                      <button
                        onClick={() => removeEntry(i)}
                        aria-label={`Remove ${p?.name ?? "player"}`}
                        title="Remove"
                        className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                      >
                        <span className="hidden md:inline">Remove</span>
                        <span aria-hidden className="md:hidden">×</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && <tr><td colSpan={simplified ? 2 : 8} className="muted">No players yet.</td></tr>}
            </tbody>
            {!simplified && (
              <tfoot>
                <tr>
                  <td className="muted">Totals</td>
                  <td className="muted">{entries.reduce((s, e) => s + Number(e.buy_ins || 0), 0)}</td>
                  <td className="muted hidden md:table-cell">€{totalPool.toFixed(2)} pool</td>
                  <td></td>
                  <td className="muted hidden md:table-cell">Awarded: €{payoutsAwarded.toFixed(2)}</td>
                  <td className={Math.abs(remaining) < 0.01 ? "muted" : "neg"}>Remaining: €{remaining.toFixed(2)}</td>
                  <td></td><td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {simplified && entries.length > 0 && (
          // Projected starting pool: each player kicks in exactly one buy-in
          // when the night begins. We show this preview so the user can
          // sanity-check the pool before starting.
          <div className="muted text-sm mt-2">
            Starting pool: €{(entries.length * t.buy_in_amount).toFixed(2)} ({entries.length} player{entries.length === 1 ? "" : "s"} × €{t.buy_in_amount} buy-in)
          </div>
        )}
      </div>

      {err && <div className="card neg">{err}</div>}

      {/* Action row. The four states drive distinct button sets:
          - create + Finished → "Create tournament" / Cancel
          - create + Active   → "Start tournament" / Cancel
          - edit  + Finished  → "Save changes" / Cancel / Delete
          - edit  + Active    → "Finish tournament" + "Save" / Cancel / Delete
          On mobile we shrink the labels so everything fits a single line. */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* For edit+Active, the primary action is "Finish tournament" — it's
            the most consequential button and earns the leading slot. "Save"
            sits next to it as the keep-it-active alternative. For every
            other case there's just one primary button. */}
        {mode === "edit" && state === "Active" && onFinish && (
          <button
            type="button"
            className="btn whitespace-nowrap"
            onClick={() => submit("finish")}
            disabled={saving || !t.location_id}
            title={!t.location_id ? "Pick a location to save" : "Mark this tournament as finished and include it in stats"}
          >
            {saving ? "Saving…" : (
              <>
                <span className="hidden sm:inline">Finish tournament</span>
                <span className="sm:hidden">Finish</span>
              </>
            )}
          </button>
        )}
        <button
          type="button"
          className={
            // When the Finish button is the primary CTA, demote Save to a
            // secondary style so the visual hierarchy reflects the intent.
            mode === "edit" && state === "Active" && onFinish
              ? "btn btn-secondary whitespace-nowrap"
              : "btn whitespace-nowrap"
          }
          onClick={() => submit("save")}
          disabled={saving || !t.location_id}
          title={!t.location_id ? "Pick a location to save" : undefined}
        >
          {saving ? "Saving…" : (
            <>
              <span className="hidden sm:inline">
                {mode === "create"
                  ? (state === "Active" ? "Start tournament" : "Create tournament")
                  : (state === "Active" ? "Save" : "Save changes")}
              </span>
              <span className="sm:hidden">
                {mode === "create" ? (state === "Active" ? "Start" : "Create") : "Save"}
              </span>
            </>
          )}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary whitespace-nowrap"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger whitespace-nowrap ml-auto"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || deleting}
          >
            <span className="hidden sm:inline">Delete tournament</span>
            <span className="sm:hidden">Delete</span>
          </button>
        )}
      </div>

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          title="Delete this tournament?"
          message={
            <>
              This permanently removes the tournament <strong>{t.name}</strong> from{" "}
              <strong>{t.date}</strong> and all <strong>{entries.length}</strong>{" "}
              player {entries.length === 1 ? "entry" : "entries"} associated with it.
              This action cannot be undone.
            </>
          }
          confirmLabel="Delete tournament"
          cancelLabel="Keep it"
          destructive
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDeleting(true);
            setErr(null);
            try {
              await onDelete();
              // No need to close — the parent navigates away on success.
            } catch (e: any) {
              setErr(e?.message ?? String(e));
              setConfirmDelete(false);
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </div>
  );
}
