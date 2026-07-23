"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { Location, Player, PayoutSlot, PayoutTier } from "@/lib/types";
import { BOUNTY_CHIP_BASE, bountyChipOptions, defaultBountyChip } from "@/lib/pko";
import { DEFAULT_PAYOUT_TIERS, validatePayoutTiers } from "@/lib/dynamic-payouts";
import { apiKeys, createLocation, createPlayer } from "@/lib/api";
import LocationCombobox from "@/components/LocationCombobox";
import PlayerCombobox from "@/components/PlayerCombobox";
import PayoutTierEditor from "@/components/PayoutTierEditor";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { Callout } from "@/components/ui/Callout";

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
  addons_allowed?: boolean;
  addon_price?: number;
  addon_chips?: number;
  dynamic_payouts?: boolean;
  payout_tiers?: PayoutTier[];
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
  section = "both",
  addonsPurchasedCount = 0,
  onSaveAddonConfig,
  inMoneyDetermined = false,
  totalEntries = 0,
  onSavePayoutTiers,
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
  // Which card(s) to render. The Settings tab shows each on its own sub-tab;
  // the modal shows "both".
  section?: "basics" | "format" | "both";
  // How many players have already bought an add-on — locks the whole add-on
  // config (allowed/price/chips) once > 0. Only relevant when section is
  // "format"/"both".
  addonsPurchasedCount?: number;
  // Persist the add-ons toggle + price/chip config. A free-standing action
  // (not part of `onSave`/`update_tournament_info`) — stays live-editable even
  // after play starts, unlike the rest of the "Format & players" card.
  onSaveAddonConfig?: (patch: { addons_allowed: boolean; addon_price: number; addon_chips: number }) => Promise<void>;
  // True once a paid-out position is confirmed (a finisher holds a paid place).
  // Locks the dynamic-payout config server-side, so the UI reflects that.
  inMoneyDetermined?: boolean;
  // Total entries so far (starting players + rebuys) — drives the tier preview.
  totalEntries?: number;
  // Persist the dynamic-payout toggle + tier ladder. Free-standing (like
  // add-ons), stays editable after play starts until in-the-money is decided.
  onSavePayoutTiers?: (patch: { dynamic_payouts: boolean; payout_tiers: PayoutTier[] }) => Promise<void>;
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

  // Add-ons: free-standing, stays editable even after play starts — only
  // locked once someone has actually bought one (`addonsPurchasedCount > 0`).
  const [addonsAllowed, setAddonsAllowed] = useState(!!t.addons_allowed);
  const [addonPrice, setAddonPrice] = useState<number>(t.addon_price ?? 0);
  const [addonChips, setAddonChips] = useState<number>(t.addon_chips ?? 0);

  // Dynamic payouts: free-standing, editable after play starts — locked only
  // once a paid-out position is confirmed (`inMoneyDetermined`).
  const [dynamicPayouts, setDynamicPayouts] = useState(!!t.dynamic_payouts);
  const [payoutTiers, setPayoutTiers] = useState<PayoutTier[]>(
    t.payout_tiers && t.payout_tiers.length ? t.payout_tiers : DEFAULT_PAYOUT_TIERS,
  );

  const [errBasics, setErrBasics] = useState<string | null>(null);
  const [errFormat, setErrFormat] = useState<string | null>(null);
  const [errAddons, setErrAddons] = useState<string | null>(null);
  const [errPayouts, setErrPayouts] = useState<string | null>(null);
  const [savingBasics, setSavingBasics] = useState(false);
  const [savingFormat, setSavingFormat] = useState(false);
  const [savingAddons, setSavingAddons] = useState(false);
  const [savingPayouts, setSavingPayouts] = useState(false);

  // The pristine values (mirror the useState initializers above) so each card
  // can detect its own unsaved edits and offer a "Reset changes".
  const initialBuyIn = t.is_pko ? (t.buy_in_amount ?? 0) + initialBounty : (t.buy_in_amount ?? 0);

  const dirtyBasics =
    date !== t.date ||
    name !== (t.name ?? "") ||
    notes !== (t.notes ?? "") ||
    locationId !== (t.location_id ?? null) ||
    special !== !!t.special;

  const dirtyFormat =
    buyIn !== initialBuyIn ||
    rebuysAllowed !== (t.rebuys_allowed ?? true) ||
    rebuyCloseLevel !== (t.rebuy_close_level ?? null) ||
    isPko !== !!t.is_pko ||
    bounty !== initialBounty ||
    bountyLevel !== (t.bounty_start_level ?? 0) ||
    bountyChip !== (t.bounty_chip ?? BOUNTY_CHIP_BASE) ||
    JSON.stringify(payout) !== JSON.stringify(t.payout_structure ?? []) ||
    !sameIds(entries.map(e => e.player_id), initialIds);

  const dirtyAddons =
    addonsAllowed !== !!t.addons_allowed ||
    addonPrice !== (t.addon_price ?? 0) ||
    addonChips !== (t.addon_chips ?? 0);

  const initialTiers = t.payout_tiers && t.payout_tiers.length ? t.payout_tiers : DEFAULT_PAYOUT_TIERS;
  const dirtyPayouts =
    dynamicPayouts !== !!t.dynamic_payouts ||
    JSON.stringify(payoutTiers) !== JSON.stringify(initialTiers);

  function resetBasics() {
    setDate(t.date);
    setName(t.name ?? "");
    setNotes(t.notes ?? "");
    setLocationId(t.location_id ?? null);
    setSpecial(!!t.special);
    setErrBasics(null);
  }

  function resetFormat() {
    setBuyInState(initialBuyIn);
    setPayout(t.payout_structure ?? []);
    setRebuysAllowed(t.rebuys_allowed ?? true);
    setRebuyCloseLevel(t.rebuy_close_level ?? null);
    setIsPko(!!t.is_pko);
    setBountyState(initialBounty);
    setBountyLevel(t.bounty_start_level ?? 0);
    setBountyChip(t.bounty_chip ?? BOUNTY_CHIP_BASE);
    setEntries(roster);
    setNewPlayerName("");
    setErrFormat(null);
  }

  function resetAddons() {
    setAddonsAllowed(!!t.addons_allowed);
    setAddonPrice(t.addon_price ?? 0);
    setAddonChips(t.addon_chips ?? 0);
    setErrAddons(null);
  }

  function resetPayouts() {
    setDynamicPayouts(!!t.dynamic_payouts);
    setPayoutTiers(initialTiers);
    setErrPayouts(null);
  }

  // Tier-ladder mutators mirror the wizard's; the editor is fully controlled.
  const mapTiers = (fn: (tiers: PayoutTier[]) => PayoutTier[]) => setPayoutTiers(prev => fn(prev));
  const setTierMin = (idx: number, min: number) =>
    mapTiers(ts => ts.map((t2, i) => (i === idx ? { ...t2, min_entries: min } : t2)));
  const setTierPct = (ti: number, pi: number, pct: number) =>
    mapTiers(ts => ts.map((t2, i) => (i === ti ? { ...t2, pcts: t2.pcts.map((p, j) => (j === pi ? pct : p)) } : t2)));
  const addTierPlace = (ti: number) =>
    mapTiers(ts => ts.map((t2, i) => (i === ti ? { ...t2, pcts: [...t2.pcts, 0] } : t2)));
  const removeTierPlace = (ti: number, pi: number) =>
    mapTiers(ts => ts.map((t2, i) => (i === ti ? { ...t2, pcts: t2.pcts.filter((_, j) => j !== pi) } : t2)));
  const addTier = () =>
    mapTiers(ts => {
      const lastMin = ts.length ? ts[ts.length - 1].min_entries : 0;
      const lastPcts = ts.length ? ts[ts.length - 1].pcts : [100];
      return [...ts, { min_entries: lastMin + 8, pcts: lastPcts }];
    });
  const removeTier = (idx: number) => mapTiers(ts => ts.filter((_, i) => i !== idx));

  async function savePayouts() {
    if (inMoneyDetermined) return;
    if (dynamicPayouts) {
      const tierErr = validatePayoutTiers(payoutTiers);
      if (tierErr) { setErrPayouts(tierErr); return; }
    }
    setSavingPayouts(true);
    setErrPayouts(null);
    try {
      await onSavePayoutTiers?.({ dynamic_payouts: dynamicPayouts, payout_tiers: dynamicPayouts ? payoutTiers : [] });
    } catch (e) {
      setErrPayouts(e instanceof Error ? e.message : "Couldn't save payout settings.");
    } finally {
      setSavingPayouts(false);
    }
  }

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
      setErrFormat("Failed to create player.");
    }
  }

  function validateBasics(): string | null {
    if (!locationId) return "Pick a location for this tournament.";
    return null;
  }

  function validateFormat(): string | null {
    // The fixed structure is only in play (and editable) when dynamic payouts
    // is off; otherwise it's derived from the tier ladder.
    if (!dynamicPayouts && Math.abs(payoutSum - 100) > 0.01) return `Payout structure must sum to 100% (currently ${payoutSum}%).`;
    if (!(buyIn >= 0)) return "Enter a valid buy-in.";
    if (isPko && !(bounty > 0)) return "Starting bounty must be greater than €0.";
    if (isPko && bounty > buyIn) return "Starting bounty can't exceed the buy-in — it's taken from it.";
    if (entries.length < 2) return "Keep at least 2 players in the tournament.";
    if (!dynamicPayouts && entries.length < paidPositions) return `The payout pays ${paidPositions} places but only ${entries.length} players are in.`;
    return null;
  }

  async function saveBasics() {
    const e = validateBasics();
    if (e) { setErrBasics(e); return; }
    setErrBasics(null);
    setSavingBasics(true);
    try {
      await onSave({ date, name: name.trim(), notes, location_id: locationId, special });
    } catch (ex) {
      setErrBasics((ex as Error).message ?? "Failed to save.");
    } finally {
      setSavingBasics(false);
    }
  }

  async function saveFormat() {
    if (playStarted) return;
    const e = validateFormat();
    if (e) { setErrFormat(e); return; }
    setErrFormat(null);
    setSavingFormat(true);
    // For PKO the stored buy-in is the prize-pool portion (total minus bounty).
    const patch: Record<string, unknown> = {
      buy_in_amount: isPko ? Math.max(0, buyIn - bounty) : buyIn,
      payout_structure: payout,
      rebuys_allowed: rebuysAllowed,
      rebuy_close_level: rebuysAllowed ? rebuyCloseLevel : null,
      is_pko: isPko,
      bounty_start_amount: isPko ? bounty : 0,
      bounty_start_level: isPko ? bountyLevel : null,
      bounty_chip: isPko ? bountyChip : null,
    };
    // Only touch the roster when it actually changed — otherwise a config edit
    // would needlessly clear the seat draw.
    const ids = entries.map(en => en.player_id);
    if (!sameIds(ids, initialIds)) patch.player_ids = ids;
    try {
      await onSave(patch);
    } catch (ex) {
      setErrFormat((ex as Error).message ?? "Failed to save.");
    } finally {
      setSavingFormat(false);
    }
  }

  async function saveAddons() {
    if (addonsPurchasedCount > 0) return;
    setErrAddons(null);
    setSavingAddons(true);
    try {
      await onSaveAddonConfig?.({ addons_allowed: addonsAllowed, addon_price: addonPrice, addon_chips: addonChips });
    } catch (ex) {
      setErrAddons((ex as Error).message ?? "Failed to save.");
    } finally {
      setSavingAddons(false);
    }
  }

  const busyBasics = busy || savingBasics;
  const busyFormat = busy || savingFormat;
  const busyAddons = busy || savingAddons;
  const busyPayouts = busy || savingPayouts;

  const inner = (
    <>
      {!inline && <h2 className="text-lg font-semibold mb-3">Edit tournament</h2>}

        <div className="space-y-4">
          {/* Basics — always editable. */}
          {section !== "format" && (
          <section className="card">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Basic info</h3>
              <p className="muted text-xs">Always editable, even after play starts.</p>
            </div>
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
          {errBasics && <div className="card neg mt-3">{errBasics}</div>}
          <div className="flex gap-2 mt-4">
            <button className="btn" disabled={busyBasics || !dirtyBasics} onClick={saveBasics}>{savingBasics ? "Saving…" : "Save changes"}</button>
            <button className="btn btn-secondary" disabled={busyBasics || !dirtyBasics} onClick={resetBasics}>Reset changes</button>
          </div>
          </section>
          )}

          {section !== "basics" && (
          <section className="card">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Format &amp; players</h3>
              <p className="muted text-xs">Buy-in, payouts, rebuys, format and the player list. Locked once play starts.</p>
            </div>
            <div className="relative">
              <fieldset
                disabled={playStarted}
                aria-hidden={playStarted}
                className={`space-y-4 min-w-0${playStarted ? " blur-[3px] opacity-60 select-none pointer-events-none max-h-64 overflow-hidden" : ""}`}
              >
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

                {/* Payout structure. Hidden when dynamic payouts is on — the
                    split is then derived from the tier ladder in the "Dynamic
                    payouts" card and re-materialized by the DB, so editing a
                    fixed table here would just be overwritten. */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="label mb-0">Payout structure</span>
                    {!dynamicPayouts && (
                      <span className={`text-sm ${Math.abs(payoutSum - 100) > 0.01 ? "neg" : "muted"}`}>Sum: {payoutSum}%</span>
                    )}
                  </div>
                  {dynamicPayouts ? (
                    <p className="muted text-sm leading-snug">
                      Managed by the tier ladder in the <strong>Dynamic payouts</strong> card below —
                      places and split scale with the entry count automatically.
                    </p>
                  ) : (
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
                  )}
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
              </fieldset>

              {playStarted && (
                <div className="absolute inset-0 flex items-start justify-center p-1 sm:p-2">
                  <div className="w-full max-w-md rounded-xl shadow-2xl" style={{ background: "var(--card)" }}>
                    <Callout variant="warning" title="Setup locked">
                      <p>
                        Play has started, so the buy-in, payouts, rebuys, format and player list are locked.
                        To edit them, restart the tournament — it rewinds to setup while keeping the basics above.
                      </p>
                      <button
                        type="button"
                        className="btn mt-3 w-full sm:w-auto justify-center whitespace-nowrap"
                        style={{ background: "rgb(251 191 36)", color: "#0b1020" }}
                        onClick={onRequestRestart}
                      >
                        Restart tournament to edit
                      </button>
                    </Callout>
                  </div>
                </div>
              )}
            </div>

            {!playStarted && (
              <>
                {errFormat && <div className="card neg mt-3">{errFormat}</div>}
                <div className="flex gap-2 mt-4">
                  <button className="btn" disabled={busyFormat || !dirtyFormat} onClick={saveFormat}>{savingFormat ? "Saving…" : "Save changes"}</button>
                  <button className="btn btn-secondary" disabled={busyFormat || !dirtyFormat} onClick={resetFormat}>Reset changes</button>
                </div>
              </>
            )}
          </section>
          )}

          {/* Add-ons — free-standing (like the rebuy window toggle): stays
              editable even after play starts. Locks only once someone has
              actually bought one, so an already-collected purchase can't
              retroactively become inconsistent with the price/chip grant. */}
          {section !== "basics" && (
          <section className="card">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Add-ons</h3>
              <p className="muted text-xs">
                {addonsPurchasedCount > 0
                  ? `Locked — ${addonsPurchasedCount} player${addonsPurchasedCount === 1 ? "" : "s"} already bought one.`
                  : "One-time chip top-up, usually offered near the end of the rebuy period. Stays editable even after play starts."}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="min-w-0">
                <span className="label">Add-ons</span>
                <div className="py-1.5">
                  <Toggle
                    checked={addonsAllowed}
                    onChange={setAddonsAllowed}
                    label={addonsAllowed ? "Allowed" : "Not allowed"}
                    size="sm"
                    labelPosition="right"
                    className="text-sm"
                    disabled={addonsPurchasedCount > 0}
                  />
                </div>
              </div>
              {addonsAllowed && (
                <>
                  <div className="min-w-0">
                    <label className="label">Add-on price (€)</label>
                    <NumberInput
                      className="input" allowDecimal value={addonPrice}
                      onChange={n => setAddonPrice(n ?? 0)} disabled={addonsPurchasedCount > 0}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="label">Chips granted</label>
                    <NumberInput
                      className="input" value={addonChips}
                      onChange={n => setAddonChips(n ?? 0)} disabled={addonsPurchasedCount > 0}
                    />
                  </div>
                </>
              )}
            </div>
            {errAddons && <div className="card neg mt-3">{errAddons}</div>}
            {addonsPurchasedCount === 0 && (
              <div className="flex gap-2 mt-4">
                <button className="btn" disabled={busyAddons || !dirtyAddons} onClick={saveAddons}>{savingAddons ? "Saving…" : "Save changes"}</button>
                <button className="btn btn-secondary" disabled={busyAddons || !dirtyAddons} onClick={resetAddons}>Reset changes</button>
              </div>
            )}
          </section>
          )}

          {/* Dynamic payouts — free-standing like add-ons: editable even after
              play starts, but locked once a paid-out position is confirmed so
              the money owed to a seated finisher can't shift under them. */}
          {section !== "basics" && onSavePayoutTiers && (
          <section className="card">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">Dynamic payouts</h3>
              <p className="muted text-[0.7rem] leading-snug mt-0.5">
                {inMoneyDetermined
                  ? "Locked — a paid position is already decided. Undo bustouts past the money bubble to edit."
                  : "Paid places and their split scale with total entries (starters + rebuys)."}
              </p>
            </div>
            <div className="mb-2">
              <Toggle
                checked={dynamicPayouts}
                onChange={setDynamicPayouts}
                label={dynamicPayouts ? "On — places scale with entries" : "Off — fixed structure"}
                size="sm"
                labelPosition="right"
                className="text-sm"
                disabled={inMoneyDetermined}
              />
            </div>
            {dynamicPayouts && (
              <PayoutTierEditor
                tiers={payoutTiers}
                onSetMin={setTierMin}
                onSetPct={setTierPct}
                onAddPlace={addTierPlace}
                onRemovePlace={removeTierPlace}
                onAddTier={addTier}
                onRemoveTier={removeTier}
                previewEntries={totalEntries}
                disabled={inMoneyDetermined}
              />
            )}
            {errPayouts && <div className="card neg mt-3">{errPayouts}</div>}
            {!inMoneyDetermined && (
              <div className="flex gap-2 mt-4">
                <button className="btn" disabled={busyPayouts || !dirtyPayouts} onClick={savePayouts}>{savingPayouts ? "Saving…" : "Save changes"}</button>
                <button className="btn btn-secondary" disabled={busyPayouts || !dirtyPayouts} onClick={resetPayouts}>Reset changes</button>
              </div>
            )}
          </section>
          )}
        </div>

        {!inline && (
          <div className="flex mt-4">
            <button className="btn btn-secondary ml-auto" disabled={busyBasics || busyFormat} onClick={onClose}>Close</button>
          </div>
        )}
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

