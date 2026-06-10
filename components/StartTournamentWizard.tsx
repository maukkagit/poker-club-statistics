"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Location, Player, PayoutSlot } from "@/lib/types";
import { apiKeys, invalidateAfterLocationMutation, invalidateAfterPlayerMutation, invalidateAfterTournamentMutation } from "@/lib/api";
import LocationCombobox from "@/components/LocationCombobox";
import PlayerCombobox from "@/components/PlayerCombobox";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import SeatDrawPanel, { type DrawResult } from "@/components/SeatDrawPanel";

type Info = {
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  notes: string;
  location_id: string | null;
  special: boolean;
  rebuys_allowed: boolean;
};

type WizardEntry = { player_id: string; name: string };

const STEPS = ["Info", "Players", "Seat draw"] as const;

/**
 * Guided "Start a tournament" wizard (issue #20). Holds everything in client
 * state across three steps — nothing is written to the DB until Confirm, which
 * creates the Active tournament + entries (+ optional seats) in one atomic RPC
 * and routes to the live page.
 */
export default function StartTournamentWizard({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const players = playersData ?? [];
  const { data: locationsData } = useSWR<Location[]>(apiKeys.locations);
  const locations = locationsData ?? [];

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [info, setInfo] = useState<Info>({
    date: new Date().toISOString().slice(0, 10),
    name: "",
    buy_in_amount: 30,
    payout_structure: [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }],
    notes: "",
    location_id: null,
    special: false,
    rebuys_allowed: true,
  });
  const [entries, setEntries] = useState<WizardEntry[]>([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [draw, setDraw] = useState<DrawResult | null>(null);
  const [skipDraw, setSkipDraw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payoutSum = info.payout_structure.reduce((s, x) => s + x.pct, 0);
  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players]);
  const playerOptions = players.filter(p => !entries.some(e => e.player_id === p.id));

  // ---- Step 1 helpers ----
  function setSlot(idx: number, patch: Partial<PayoutSlot>) {
    setInfo(prev => ({ ...prev, payout_structure: prev.payout_structure.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }
  function addSlot() {
    setInfo(prev => ({ ...prev, payout_structure: [...prev.payout_structure, { position: prev.payout_structure.length + 1, pct: 0 }] }));
  }
  function removeSlot(idx: number) {
    setInfo(prev => ({ ...prev, payout_structure: prev.payout_structure.filter((_, i) => i !== idx) }));
  }

  // ---- Step 2 helpers ----
  function addEntry(player_id: string) {
    if (!player_id || entries.some(e => e.player_id === player_id)) return;
    setEntries(es => [...es, { player_id, name: nameById.get(player_id) ?? "?" }]);
    setDraw(null); setSkipDraw(false); // roster change invalidates a prior draw
  }
  function removeEntry(player_id: string) {
    setEntries(es => es.filter(e => e.player_id !== player_id));
    setDraw(null); setSkipDraw(false);
  }
  async function createNewPlayer() {
    if (!newPlayerName.trim()) return;
    const r = await fetch("/api/players", { method: "POST", body: JSON.stringify({ name: newPlayerName.trim() }) });
    if (!r.ok) { setErr("Failed to create player"); return; }
    const p: Player = await r.json();
    setNewPlayerName("");
    await invalidateAfterPlayerMutation();
    setEntries(es => es.some(e => e.player_id === p.id) ? es : [...es, { player_id: p.id, name: p.name }]);
    setDraw(null); setSkipDraw(false);
  }

  // ---- Navigation guards ----
  function step1Valid(): string | null {
    if (!info.location_id) return "Pick a location for this tournament.";
    if (Math.abs(payoutSum - 100) > 0.01) return `Payout structure must sum to 100% (currently ${payoutSum}%).`;
    if (!(info.buy_in_amount >= 0)) return "Enter a valid buy-in.";
    return null;
  }
  function next() {
    setErr(null);
    if (step === 0) {
      const e = step1Valid();
      if (e) { setErr(e); return; }
      setStep(1);
    } else if (step === 1) {
      if (entries.length < 2) { setErr("Add at least 2 players."); return; }
      setStep(2);
    }
  }
  function back() { setErr(null); setStep(s => (s > 0 ? ((s - 1) as 0 | 1) : 0)); }

  // ---- Confirm ----
  async function confirm() {
    setErr(null);
    setSubmitting(true);
    try {
      const bucketByPid = draw?.bucketByPlayerId ?? {};
      const body = {
        date: info.date,
        name: info.name.trim(),
        buy_in_amount: info.buy_in_amount,
        payout_structure: info.payout_structure,
        notes: info.notes,
        location_id: info.location_id,
        special: info.special,
        rebuys_allowed: info.rebuys_allowed,
        entries: entries.map(e => ({ player_id: e.player_id, bucket: bucketByPid[e.player_id] ?? null })),
        seating: draw && !skipDraw ? draw.seating : null,
        assignments: draw && !skipDraw ? draw.assignments : null,
      };
      const res = await fetch("/api/tournaments/start", { method: "POST", body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to start tournament");
      await invalidateAfterTournamentMutation(json.id);
      router.push(`/tournaments/${json.id}`);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Stepper step={step} />

      {step === 0 && (
        <div className="space-y-4">
          <div className="card grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="min-w-0"><label className="label">Date</label><input className="input" type="date" value={info.date} onChange={e => setInfo({ ...info, date: e.target.value })} /></div>
            <div className="min-w-0 md:col-span-2">
              <label className="label">Name <span className="muted font-normal">(optional)</span></label>
              <input className="input" value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })} placeholder="Leave blank to use Tournament #N" />
            </div>
            <div className="min-w-0"><label className="label">Buy-in (€)</label><NumberInput className="input" value={info.buy_in_amount} onChange={n => setInfo({ ...info, buy_in_amount: n ?? 0 })} /></div>
            <div className="min-w-0 md:col-span-2">
              <label className="label">Location <span className="neg font-normal" aria-hidden>*</span></label>
              <LocationCombobox
                value={info.location_id ?? null}
                locations={locations}
                onChange={id => setInfo(prev => ({ ...prev, location_id: id }))}
                onCreate={async name => {
                  const res = await fetch("/api/locations", { method: "POST", body: JSON.stringify({ name }) });
                  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? "Failed to create location"); }
                  const created: Location = await res.json();
                  await invalidateAfterLocationMutation();
                  return created;
                }}
              />
            </div>
            <div className="min-w-0 md:col-span-2"><label className="label">Notes</label><input className="input" value={info.notes} onChange={e => setInfo({ ...info, notes: e.target.value })} /></div>
            <div className="min-w-0 md:col-span-2">
              <span className="label">Type</span>
              <div className="py-1.5">
                <Toggle checked={info.special} onChange={next => setInfo({ ...info, special: next })} label="Special tournament" size="sm" labelPosition="right" className="text-sm" />
              </div>
              <p className="muted text-xs leading-snug">Excluded from dashboard stats by default. Use for themed events.</p>
            </div>
            <div className="min-w-0 md:col-span-2">
              <span className="label">Rebuys</span>
              <div className="py-1.5">
                <Toggle checked={info.rebuys_allowed} onChange={next => setInfo({ ...info, rebuys_allowed: next })} label="Rebuys allowed" size="sm" labelPosition="right" className="text-sm" />
              </div>
              <p className="muted text-xs leading-snug">Whether players can rebuy. Fixed for the night — you control the open/closed window live.</p>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Payout structure</h2>
              <div className={`text-sm ${Math.abs(payoutSum - 100) > 0.01 ? "neg" : "muted"}`}>Sum: {payoutSum}%</div>
            </div>
            <div className="space-y-2">
              {info.payout_structure.map((s, i) => (
                <div key={i} className="flex flex-wrap gap-x-2 gap-y-1 items-center">
                  <span className="muted text-sm w-16 hidden sm:inline">Position</span>
                  <NumberInput className="input w-12 sm:w-20 shrink-0" value={s.position} onChange={n => setSlot(i, { position: n ?? 1 })} />
                  <NumberInput className="input w-16 sm:w-24 shrink-0" allowDecimal value={s.pct} onChange={n => setSlot(i, { pct: n ?? 0 })} />
                  <span className="muted shrink-0">%</span>
                  <button onClick={() => removeSlot(i)} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)] shrink-0 ml-auto">Remove</button>
                </div>
              ))}
              <button onClick={addSlot} className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]">+ Add place</button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Who&apos;s playing?</h2>
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
                <button onClick={createNewPlayer} className="btn whitespace-nowrap shrink-0" disabled={!newPlayerName.trim()}>+ Add</button>
              </div>
            </div>
          </div>

          {entries.length === 0 ? (
            <p className="muted text-sm">No players yet. Add at least 2 to continue.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {entries.map(e => (
                <li key={e.player_id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                  <span>{e.name}</span>
                  <button onClick={() => removeEntry(e.player_id)} aria-label={`Remove ${e.name}`} title="Remove" className="muted hover:text-[var(--neg)]">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="muted text-sm mt-3">
            {entries.length} player{entries.length === 1 ? "" : "s"} · projected starting pool €{(entries.length * info.buy_in_amount).toFixed(2)}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold mb-1">Seat draw <span className="muted font-normal text-sm">(optional)</span></h2>
            <p className="muted text-sm mb-3">Draw a random seating now, or skip and draw later from the live page.</p>
            <SeatDrawPanel
              players={entries.map(e => ({ player_id: e.player_id, name: e.name }))}
              onResult={r => { setDraw(r); if (r) setSkipDraw(false); }}
            />
          </div>
        </div>
      )}

      {err && <div className="card neg">{err}</div>}

      {/* Footer actions */}
      <div className="flex gap-2 flex-wrap items-center">
        {step > 0 && <button type="button" className="btn btn-secondary" onClick={back} disabled={submitting}>Back</button>}
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        <div className="ml-auto flex gap-2">
          {step < 2 && <button type="button" className="btn" onClick={next}>Next</button>}
          {step === 2 && (
            <>
              {!draw && (
                <button type="button" className="btn btn-secondary" onClick={() => { setSkipDraw(true); confirm(); }} disabled={submitting}>
                  {submitting ? "Starting…" : "Skip & start"}
                </button>
              )}
              {draw && (
                <button type="button" className="btn" onClick={confirm} disabled={submitting}>
                  {submitting ? "Starting…" : "Confirm & start"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold"
              style={{
                background: active ? "var(--accent)" : done ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "var(--bg)",
                color: active ? "#fff" : "var(--text)",
                borderColor: active || done ? "transparent" : "var(--border)",
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={active ? "font-semibold" : "muted"}>{label}</span>
            {i < STEPS.length - 1 && <span className="muted mx-1">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
