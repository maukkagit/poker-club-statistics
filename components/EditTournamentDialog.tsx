"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { Location, Player, PayoutSlot } from "@/lib/types";
import { BOUNTY_CHIP_BASE, bountyChipOptions, defaultBountyChip } from "@/lib/pko";
import { apiKeys, createLocation, createPlayer } from "@/lib/api";
import LocationCombobox from "@/components/LocationCombobox";
import PlayerCombobox from "@/components/PlayerCombobox";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";

type RosterEntry = { player_id: string; name: string };

/** The subset of tournament setup fields this dialog reads/edits. */
type EditableTournament = {
  date: string;
  name: string;
  notes?: string | null;
  location_id?: string | null;
  special?: boolean;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  rebuys_allowed?: boolean;
  rebuy_close_level?: number | null;
  is_pko?: boolean;
  bounty_start_amount?: number;
  bounty_start_level?: number | null;
  bounty_chip?: number;
};

/** Default starting bounty for a PKO: half the buy-in, rounded to cents. */
const halfBuyIn = (buyIn: number) => Math.round((buyIn / 2) * 100) / 100;
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/**
 * Edit a live tournament's setup from the live manager — the same data points
 * the "Start a tournament" wizard collects on its Info step, plus the player
 * roster. The blind structure, starting stack and seat draw keep their own
 * dedicated live controls and aren't duplicated here.
 *
 * Basic metadata (date, name, location, notes, special) is always editable.
 * Everything that defines the money / format / field (buy-in, payouts, rebuys,
 * PKO settings, the roster) is frozen once the clock has started: the dialog
 * shows a read-only summary and points the director at "Restart tournament".
 */
export default function EditTournamentDialog({
  tournament: t,
  roster,
  playStarted,
  busy,
  onClose,
  onSave,
  onRequestRestart,
  inline = false,
}: {
  tournament: EditableTournament;
  roster: RosterEntry[];
  playStarted: boolean;
  busy: boolean;
  onClose?: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onRequestRestart: () => void;
  // When true, render the form inline (no modal overlay / Cancel button) — used
  // by the live manager's Settings tab, which shows it directly in a card.
  inline?: boolean;
}) {
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const players = playersData ?? [];
  const { data: locationsData } = useSWR<Location[]>(apiKeys.locations);
  const locations = locationsData ?? [];
  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players]);

  // Basic metadata (always editable).
  const [date, setDate] = useState(t.date);
  const [name, setName] = useState(t.name ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  const [locationId, setLocationId] = useState<string | null>(t.location_id ?? null);
  const [special, setSpecial] = useState(!!t.special);

  // Setup / config (locked once play starts). For PKO the stored `buy_in_amount`
  // is the prize-pool portion only, so reconstruct the entered TOTAL buy-in.
  const initialBounty = t.bounty_start_amount ?? 0;
  const [buyIn, setBuyInState] = useState<number>(
    t.is_pko ? (t.buy_in_amount ?? 0) + initialBounty : (t.buy_in_amount ?? 0),
  );
  const [payout, setPayout] = useState<PayoutSlot[]>(t.payout_structure ?? []);
  const [rebuysAllowed, setRebuysAllowed] = useState(t.rebuys_allowed ?? true);
  const [rebuyCloseLevel, setRebuyCloseLevel] = useState<number | null>(t.rebuy_close_level ?? null);
  const [isPko, setIsPko] = useState(!!t.is_pko);
  const [bounty, setBountyState] = useState<number>(initialBounty);
  const [bountyLevel, setBountyLevel] = useState<number>(t.bounty_start_level ?? 0);
  const [bountyChip, setBountyChip] = useState<number>(t.bounty_chip ?? BOUNTY_CHIP_BASE);

  // Roster (locked once play starts).
  const initialIds = useMemo(() => roster.map(r => r.player_id), [roster]);
  const [entries, setEntries] = useState<RosterEntry[]>(roster);
  const [newPlayerName, setNewPlayerName] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const payoutSum = payout.reduce((s, x) => s + x.pct, 0);
  const paidPositions = payout.length;
  const playerOptions = players.filter(p => !entries.some(e => e.player_id === p.id));

  function validChip(startAmount: number, current: number): number {
    return bountyChipOptions(startAmount).includes(current) ? current : defaultBountyChip(startAmount);
  }
  function setPko(on: boolean) {
    setIsPko(on);
    const b = on ? halfBuyIn(buyIn) : bounty;
    setBountyState(b);
    setBountyChip(prev => (on ? validChip(b, prev) : prev));
    setPayout(on
      ? [{ position: 1, pct: 40 }, { position: 2, pct: 40 }, { position: 3, pct: 20 }]
      : [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }]);
  }
  function setBuyIn(amount: number) {
    setBuyInState(amount);
    const b = halfBuyIn(amount);
    setBountyState(b);
    setBountyChip(prev => validChip(b, prev));
  }
  function setBounty(amount: number) {
    const b = Math.max(0, amount);
    setBountyState(b);
    setBountyChip(prev => validChip(b, prev));
  }
  function setSlot(idx: number, patch: Partial<PayoutSlot>) {
    setPayout(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addSlot() {
    setPayout(prev => [...prev, { position: prev.length + 1, pct: 0 }]);
  }
  function removeSlot(idx: number) {
    setPayout(prev => prev.filter((_, i) => i !== idx));
  }
  function addEntry(playerId: string) {
    if (!playerId || entries.some(e => e.player_id === playerId)) return;
    setEntries(es => [...es, { player_id: playerId, name: nameById.get(playerId) ?? "?" }]);
  }
  function removeEntry(playerId: string) {
    setEntries(es => es.filter(e => e.player_id !== playerId));
  }
  async function createNewPlayer() {
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;
    try {
      const p = await createPlayer(trimmed);
      setNewPlayerName("");
      setEntries(es => (es.some(e => e.player_id === p.id) ? es : [...es, { player_id: p.id, name: p.name }]));
    } catch {
      setErr("Failed to create player.");
    }
  }

  /** Validate the fields that are editable in this open state. */
  function validate(): string | null {
    if (!locationId) return "Pick a location for this tournament.";
    if (playStarted) return null; // only basic fields are editable
    if (Math.abs(payoutSum - 100) > 0.01) return `Payout structure must sum to 100% (currently ${payoutSum}%).`;
    if (!(buyIn >= 0)) return "Enter a valid buy-in.";
    if (isPko && !(bounty > 0)) return "Starting bounty must be greater than €0.";
    if (isPko && bounty > buyIn) return "Starting bounty can't exceed the buy-in — it's taken from it.";
    if (entries.length < 2) return "Keep at least 2 players in the tournament.";
    if (entries.length < paidPositions) return `The payout pays ${paidPositions} places but only ${entries.length} players are in.`;
    return null;
  }

  async function save() {
    const e = validate();
    if (e) { setErr(e); return; }
    setErr(null);
    setSaving(true);
    // Basic metadata is always sent.
    const patch: Record<string, unknown> = {
      date,
      name: name.trim(),
      notes,
      location_id: locationId,
      special,
    };
    if (!playStarted) {
      // For PKO the stored buy-in is the prize-pool portion (total minus bounty).
      patch.buy_in_amount = isPko ? Math.max(0, buyIn - bounty) : buyIn;
      patch.payout_structure = payout;
      patch.rebuys_allowed = rebuysAllowed;
      patch.rebuy_close_level = rebuysAllowed ? rebuyCloseLevel : null;
      patch.is_pko = isPko;
      patch.bounty_start_amount = isPko ? bounty : 0;
      patch.bounty_start_level = isPko ? bountyLevel : null;
      patch.bounty_chip = isPko ? bountyChip : null;
      // Only touch the roster when it actually changed — otherwise a metadata
      // edit would needlessly clear the seat draw.
      const ids = entries.map(en => en.player_id);
      if (!sameIds(ids, initialIds)) patch.player_ids = ids;
    }
    try {
      await onSave(patch);
      onClose?.();
    } catch (ex) {
      setErr((ex as Error).message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const busyAny = busy || saving;

  const inner = (
    <>
      {!inline && <h2 className="text-lg font-semibold mb-3">Edit tournament</h2>}

        <div className="space-y-4">
          {/* Basics — always editable. */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="min-w-0">
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="min-w-0 md:col-span-2">
              <label className="label">Name <span className="muted font-normal">(optional)</span></label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Leave blank to use Tournament #N" />
            </div>
            <div className="min-w-0">
              <span className="label">Type</span>
              <div className="py-1.5">
                <Toggle checked={special} onChange={setSpecial} label="Special" size="sm" labelPosition="right" className="text-sm" />
              </div>
            </div>
            <div className="min-w-0 md:col-span-2">
              <label className="label">Location <span className="neg font-normal" aria-hidden>*</span></label>
              <LocationCombobox value={locationId} locations={locations} onChange={setLocationId} onCreate={createLocation} />
            </div>
            <div className="min-w-0 md:col-span-2">
              <label className="label">Notes</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {playStarted ? (
              <LockedSetupSummary
                tournament={t}
                buyIn={buyIn}
                playerCount={entries.length}
                onRequestRestart={onRequestRestart}
              />
            ) : (
              <div className="space-y-4">
                {/* Format / money config. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="min-w-0">
                    <label className="label">Buy-in (€)</label>
                    <NumberInput className="input" allowDecimal value={buyIn} onChange={n => setBuyIn(n ?? 0)} />
                  </div>
                  <div className="min-w-0">
                    <span className="label">Rebuys</span>
                    <div className="py-1.5">
                      <Toggle checked={rebuysAllowed} onChange={setRebuysAllowed} label="Allowed" size="sm" labelPosition="right" className="text-sm" />
                    </div>
                  </div>
                  {rebuysAllowed && (
                    <div className="min-w-0">
                      <label className="label">Close from level <span className="muted font-normal">(opt.)</span></label>
                      <NumberInput className="input" value={rebuyCloseLevel} onChange={setRebuyCloseLevel} emptyBlurBehavior="null" placeholder="—" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="label">Format</span>
                    <div className="py-1.5">
                      <Toggle checked={isPko} onChange={setPko} label="PKO" size="sm" labelPosition="right" className="text-sm" />
                    </div>
                  </div>
                </div>

                {isPko && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="min-w-0">
                      <label className="label">Starting bounty (€)</label>
                      <NumberInput className="input" allowDecimal value={bounty} onChange={n => setBounty(n ?? 0)} />
                      {bounty > buyIn ? (
                        <p className="text-xs leading-snug mt-1 text-red-500">Can&apos;t exceed the buy-in (€{buyIn.toFixed(2)}).</p>
                      ) : (
                        <p className="muted text-xs leading-snug mt-1">Taken from the buy-in — max €{buyIn.toFixed(2)}.</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <label className="label">Bounty phase from level</label>
                      <NumberInput className="input" value={bountyLevel} onChange={n => setBountyLevel(n ?? 0)} />
                    </div>
                    <div className="min-w-0">
                      <label className="label">Bounty token (€)</label>
                      <select className="input" value={bountyChip} onChange={e => setBountyChip(Number(e.target.value))}>
                        {bountyChipOptions(bounty).map(v => <option key={v} value={v}>€{v.toFixed(2)}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* Payout structure. */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="label mb-0">Payout structure</span>
                    <span className={`text-sm ${Math.abs(payoutSum - 100) > 0.01 ? "neg" : "muted"}`}>Sum: {payoutSum}%</span>
                  </div>
                  <div className="space-y-2">
                    {payout.map((s, i) => (
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

                {/* Roster. */}
                <div>
                  <span className="label">Who&apos;s playing?</span>
                  <div className="flex flex-wrap gap-2 mb-2 items-end">
                    <div className="flex-1 min-w-[180px]">
                      <PlayerCombobox
                        players={playerOptions}
                        onSelect={addEntry}
                        placeholder={playerOptions.length === 0 ? "All players already added" : "Add existing player…"}
                        disabled={playerOptions.length === 0}
                      />
                    </div>
                    <div className="flex-1 min-w-[180px] flex gap-2 items-center">
                      <input className="input" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} placeholder="Or create new" />
                      <button onClick={createNewPlayer} className="btn whitespace-nowrap shrink-0" disabled={!newPlayerName.trim()}>+ Add</button>
                    </div>
                  </div>
                  {entries.length === 0 ? (
                    <p className="muted text-sm">No players. Add at least 2.</p>
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
                  <p className="muted text-xs leading-snug mt-2">Changing the roster clears the current seat draw — redraw seats afterwards.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {err && <div className="card neg mt-4">{err}</div>}

        <div className="flex gap-2 mt-4">
          <button className="btn" disabled={busyAny} onClick={save}>{busyAny ? "Saving…" : "Save changes"}</button>
          {!inline && <button className="btn btn-secondary ml-auto" disabled={busyAny} onClick={onClose}>Cancel</button>}
        </div>
    </>
  );

  if (inline) return inner;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className="relative w-full max-w-3xl rounded-xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {inner}
      </div>
    </div>
  );
}

/** Read-only recap of the frozen setup shown once the clock has started, with a
 *  clear pointer to the only way to change it: restarting the tournament. */
function LockedSetupSummary({
  tournament: t,
  buyIn,
  playerCount,
  onRequestRestart,
}: {
  tournament: EditableTournament;
  buyIn: number;
  playerCount: number;
  onRequestRestart: () => void;
}) {
  const rows: [string, string][] = [
    ["Buy-in", `€${buyIn.toFixed(2)}`],
    ["Rebuys", t.rebuys_allowed ? "Allowed" : "Not allowed"],
    ["Format", t.is_pko ? "Progressive knockout (PKO)" : "Regular"],
    ["Payout places", String((t.payout_structure ?? []).length)],
    ["Players", String(playerCount)],
  ];
  return (
    <div>
      <div
        className="rounded px-3 py-2 text-sm mb-3"
        style={{ background: "rgb(251 191 36 / 0.12)", border: "1px solid rgb(251 191 36 / 0.5)" }}
      >
        Play has started, so the buy-in, payouts, rebuys, format and player list are locked. To change any of
        these, restart the tournament first — that rewinds it to setup while keeping everything above.
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm mb-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b py-1" style={{ borderColor: "var(--border)" }}>
            <dt className="muted">{k}</dt>
            <dd className="font-medium text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={onRequestRestart}>Restart tournament</button>
        <span className="muted text-sm">Rewinds to setup so you can edit these fields.</span>
      </div>
    </div>
  );
}
