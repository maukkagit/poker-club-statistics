"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Location, Player, PayoutSlot, PayoutTier, Seating } from "@/lib/types";
import { tablesFor } from "@/lib/seating";
import { BOUNTY_CHIP_BASE, bountyChipOptions, defaultBountyChip } from "@/lib/pko";
import { DEFAULT_PAYOUT_TIERS, resolveDynamicPayoutStructure, validatePayoutTiers } from "@/lib/dynamic-payouts";
import { apiKeys, createLocation, createPlayer, invalidateAfterTournamentMutation } from "@/lib/api";
import LocationCombobox from "@/components/LocationCombobox";
import PlayerCombobox from "@/components/PlayerCombobox";
import NumberInput from "@/components/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { Callout } from "@/components/ui/Callout";
import SeatDrawPanel, { type DrawResult } from "@/components/SeatDrawPanel";
import StructureEditor from "@/components/StructureEditor";
import PayoutTierEditor from "@/components/PayoutTierEditor";
import { useTournamentStructure } from "@/components/useTournamentStructure";

type Info = {
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  notes: string;
  location_id: string | null;
  special: boolean;
  rebuys_allowed: boolean;
  // Level at which re-entries auto-close. Null = director manages manually.
  rebuy_close_level: number | null;
  // Dynamic (entry-scaled) payouts. When on, the paid places + split come from
  // `payout_tiers` based on the total entry count instead of the fixed
  // `payout_structure` above.
  dynamic_payouts: boolean;
  payout_tiers: PayoutTier[];
  // Whether add-ons are offered. Unlike rebuys_allowed this can still be
  // flipped live from the director console once the tournament is running.
  addons_allowed: boolean;
  // Progressive knockout (PKO). When on, `buy_in_amount` is the regular
  // prize-pool contribution and `bounty_start_amount` is the per-entry starting
  // bounty; the bounty phase begins at `bounty_start_level`.
  is_pko: boolean;
  bounty_start_amount: number;
  // Blind level at which the bounty phase begins. Required; 0 means knockouts
  // pay cash from the very start of the tournament.
  bounty_start_level: number;
  // Cash increment every bounty payout is rounded to. Must be a valid option
  // for the current starting bounty (see bountyChipOptions). Defaults to 2.50.
  bounty_chip: number;
  // Seats per table (table format). A free integer, default 6, capped at the
  // engine max. Chosen on the Seat-draw step so the field size isn't asked
  // about in two places.
  table_size: number;
};

const DEFAULT_SEATS_PER_TABLE = 6;
const DEFAULT_BUY_IN = 30;
/** Default starting bounty for a PKO: half the buy-in, rounded to cents. */
const halfBuyIn = (buyIn: number) => Math.round((buyIn / 2) * 100) / 100;

type WizardEntry = { player_id: string; name: string };

const STEPS = ["Info", "Players", "Structure", "Seat draw"] as const;

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

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const structure = useTournamentStructure();
  const [info, setInfo] = useState<Info>({
    date: new Date().toISOString().slice(0, 10),
    name: "",
    buy_in_amount: DEFAULT_BUY_IN,
    payout_structure: [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }],
    notes: "",
    location_id: null,
    special: false,
    rebuys_allowed: true,
    rebuy_close_level: null,
    addons_allowed: false,
    dynamic_payouts: false,
    payout_tiers: DEFAULT_PAYOUT_TIERS,
    is_pko: false,
    bounty_start_amount: halfBuyIn(DEFAULT_BUY_IN),
    bounty_start_level: 0,
    bounty_chip: BOUNTY_CHIP_BASE,
    table_size: DEFAULT_SEATS_PER_TABLE,
  });
  const [entries, setEntries] = useState<WizardEntry[]>([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [draw, setDraw] = useState<DrawResult | null>(null);
  const [skipDraw, setSkipDraw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payoutSum = info.payout_structure.reduce((s, x) => s + x.pct, 0);
  // Effective paid places. With dynamic payouts the count depends on the field
  // size, so we resolve the tier that applies to the current entrant count
  // (the floor tier for a small field); otherwise it's the fixed structure.
  const paidPositions = info.dynamic_payouts
    ? resolveDynamicPayoutStructure(info.payout_tiers, entries.length).length
    : info.payout_structure.length;
  const tooFewPlayers = entries.length > 0 && entries.length < paidPositions;
  // The Players step needs at least 2 players and at least one per paid place.
  const enoughPlayers = entries.length >= 2 && entries.length >= paidPositions;
  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players]);
  const playerOptions = players.filter(p => !entries.some(e => e.player_id === p.id));

  // ---- Step 1 helpers ----
  // Toggle PKO. Turning it on seeds the standard PKO 40/40/20 top-three split;
  // turning it off restores the regular 60/25/15 default. Either way the user
  // can still edit the split below.
  function setPko(on: boolean) {
    setInfo(prev => {
      // Default the starting bounty to half the buy-in when enabling PKO.
      const bounty = on ? halfBuyIn(prev.buy_in_amount) : prev.bounty_start_amount;
      return {
      ...prev,
      is_pko: on,
      bounty_start_amount: bounty,
      bounty_chip: on ? validChip(bounty, prev.bounty_chip) : prev.bounty_chip,
      payout_structure: on
        ? [{ position: 1, pct: 40 }, { position: 2, pct: 40 }, { position: 3, pct: 20 }]
        : [{ position: 1, pct: 60 }, { position: 2, pct: 25 }, { position: 3, pct: 15 }],
      };
    });
  }
  // The bounty is carved out of the buy-in, so it can never exceed it. Setting
  // the buy-in clamps the bounty down to fit; setting the bounty clamps to the
  // buy-in.
  // Keep the chosen bounty token valid for the current starting bounty: if the
  // bounty changed such that the token no longer divides bounty/2, fall back to
  // the default (2.50 when possible, else the smallest valid option).
  function validChip(startAmount: number, current: number): number {
    return bountyChipOptions(startAmount).includes(current) ? current : defaultBountyChip(startAmount);
  }
  function setBuyIn(amount: number) {
    setInfo(prev => {
      // The starting bounty defaults to half the buy-in, so re-derive it when the
      // buy-in changes (for non-PKO this value is unused).
      const bounty = halfBuyIn(amount);
      return { ...prev, buy_in_amount: amount, bounty_start_amount: bounty, bounty_chip: validChip(bounty, prev.bounty_chip) };
    });
  }
  function setBounty(amount: number) {
    setInfo(prev => {
      // Keep what the user typed (only guard against negatives) so an over-the-buy-in
      // value isn't silently shrunk — step-1 validation surfaces the problem instead.
      const bounty = Math.max(0, amount);
      return { ...prev, bounty_start_amount: bounty, bounty_chip: validChip(bounty, prev.bounty_chip) };
    });
  }
  function setSlot(idx: number, patch: Partial<PayoutSlot>) {
    setInfo(prev => ({ ...prev, payout_structure: prev.payout_structure.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }
  function addSlot() {
    setInfo(prev => ({ ...prev, payout_structure: [...prev.payout_structure, { position: prev.payout_structure.length + 1, pct: 0 }] }));
  }
  function removeSlot(idx: number) {
    setInfo(prev => ({ ...prev, payout_structure: prev.payout_structure.filter((_, i) => i !== idx) }));
  }

  // ---- Dynamic payout tier helpers ----
  function mapTiers(fn: (tiers: PayoutTier[]) => PayoutTier[]) {
    setInfo(prev => ({ ...prev, payout_tiers: fn(prev.payout_tiers) }));
  }
  function setTierMin(idx: number, min: number) {
    mapTiers(tiers => tiers.map((t, i) => (i === idx ? { ...t, min_entries: min } : t)));
  }
  function setTierPct(tierIdx: number, placeIdx: number, pct: number) {
    mapTiers(tiers => tiers.map((t, i) =>
      i === tierIdx ? { ...t, pcts: t.pcts.map((p, j) => (j === placeIdx ? pct : p)) } : t));
  }
  function addTierPlace(tierIdx: number) {
    mapTiers(tiers => tiers.map((t, i) => (i === tierIdx ? { ...t, pcts: [...t.pcts, 0] } : t)));
  }
  function removeTierPlace(tierIdx: number, placeIdx: number) {
    mapTiers(tiers => tiers.map((t, i) =>
      i === tierIdx ? { ...t, pcts: t.pcts.filter((_, j) => j !== placeIdx) } : t));
  }
  function addTier() {
    mapTiers(tiers => {
      const lastMin = tiers.length ? tiers[tiers.length - 1].min_entries : 0;
      const lastPcts = tiers.length ? tiers[tiers.length - 1].pcts : [100];
      return [...tiers, { min_entries: lastMin + 8, pcts: lastPcts }];
    });
  }
  function removeTier(idx: number) {
    mapTiers(tiers => tiers.filter((_, i) => i !== idx));
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
    try {
      const p = await createPlayer(newPlayerName.trim());
      setNewPlayerName("");
      setEntries(es => es.some(e => e.player_id === p.id) ? es : [...es, { player_id: p.id, name: p.name }]);
      setDraw(null); setSkipDraw(false); // roster change invalidates a prior draw
    } catch {
      setErr("Failed to create player");
    }
  }

  // ---- Navigation guards ----
  function step1Valid(): string | null {
    if (!info.location_id) return "Pick a location for this tournament.";
    if (info.dynamic_payouts) {
      const tierErr = validatePayoutTiers(info.payout_tiers);
      if (tierErr) return tierErr;
    } else if (Math.abs(payoutSum - 100) > 0.01) {
      return `Payout structure must sum to 100% (currently ${payoutSum}%).`;
    }
    if (!(info.buy_in_amount >= 0)) return "Enter a valid buy-in.";
    if (info.is_pko && !(info.bounty_start_amount > 0)) {
      return "Starting bounty must be greater than €0.";
    }
    if (info.is_pko && info.bounty_start_amount > info.buy_in_amount) {
      return "Starting bounty can't exceed the buy-in — it's taken from it.";
    }
    return null;
  }
  function next() {
    setErr(null);
    if (step === 0) {
      const e = step1Valid();
      if (e) { setErr(e); return; }
      setStep(1);
    } else if (step === 1) {
      // The Next button is disabled until this holds; the inline banners on the
      // step explain what's missing, so we don't surface a separate red error.
      if (!enoughPlayers) return;
      setStep(2);
    } else if (step === 2) {
      if (structure.error) { setErr(structure.error); return; }
      setStep(3);
    }
  }
  function back() { setErr(null); setStep(s => (s > 0 ? ((s - 1) as 0 | 1 | 2 | 3) : 0)); }

  // ---- Confirm ----
  async function confirm() {
    setErr(null);
    setSubmitting(true);
    try {
      const bucketByPid = draw?.bucketByPlayerId ?? {};
      // Even when the draw is skipped, persist the chosen table format so the
      // live page's draw-later / visualizations honour the 6/9/10-max choice.
      const formatStub: Seating = {
        tables: tablesFor(entries.length, info.table_size),
        seats_per_table: info.table_size,
        buckets_used: false,
        buttons: {},
        drawn_at: new Date().toISOString(),
      };
      const body = {
        date: info.date,
        name: info.name.trim(),
        // For PKO the entered buy-in is the TOTAL entry fee; the bounty is
        // carved out of it, so the stored `buy_in_amount` (the regular
        // prize-pool contribution) is buy-in minus bounty.
        buy_in_amount: info.is_pko
          ? Math.max(0, info.buy_in_amount - info.bounty_start_amount)
          : info.buy_in_amount,
        // With dynamic payouts, seed the stored structure with the split
        // resolved for the starting field; the DB re-materializes it as the
        // field grows. Otherwise send the fixed structure as entered.
        payout_structure: info.dynamic_payouts
          ? resolveDynamicPayoutStructure(info.payout_tiers, entries.length)
          : info.payout_structure,
        notes: info.notes,
        location_id: info.location_id,
        special: info.special,
        rebuys_allowed: info.rebuys_allowed,
        rebuy_close_level: info.rebuy_close_level,
        dynamic_payouts: info.dynamic_payouts,
        payout_tiers: info.dynamic_payouts ? info.payout_tiers : [],
        addons_allowed: info.addons_allowed,
        entries: entries.map(e => ({ player_id: e.player_id, bucket: bucketByPid[e.player_id] ?? null })),
        seating: draw && !skipDraw ? draw.seating : formatStub,
        assignments: draw && !skipDraw ? draw.assignments : null,
        structure: structure.structure,
        starting_stack: structure.startingStack,
        is_pko: info.is_pko,
        bounty_start_amount: info.is_pko ? info.bounty_start_amount : 0,
        bounty_start_level: info.is_pko ? info.bounty_start_level : null,
        bounty_chip: info.is_pko ? info.bounty_chip : null,
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
          <div className="card space-y-4">
            {/* Basics — the core identity of the tournament. */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="min-w-0"><label className="label">Date</label><input className="input" type="date" value={info.date} onChange={e => setInfo({ ...info, date: e.target.value })} /></div>
              <div className="min-w-0 md:col-span-2">
                <label className="label">Name <span className="muted font-normal">(optional)</span></label>
                <input className="input" value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })} placeholder="Leave blank to use Tournament #N" />
              </div>
              <div className="min-w-0"><label className="label">Buy-in (€)</label><NumberInput className="input" allowDecimal value={info.buy_in_amount} onChange={n => setBuyIn(n ?? 0)} /></div>
              <div className="min-w-0 md:col-span-2">
                <label className="label">Location <span className="neg font-normal" aria-hidden>*</span></label>
                <LocationCombobox
                  value={info.location_id ?? null}
                  locations={locations}
                  onChange={id => setInfo(prev => ({ ...prev, location_id: id }))}
                  onCreate={createLocation}
                />
              </div>
              <div className="min-w-0 md:col-span-2"><label className="label">Notes</label><input className="input" value={info.notes} onChange={e => setInfo({ ...info, notes: e.target.value })} /></div>
            </div>

            {/* Options — the three format toggles, each its own equal column so
                the row stays even regardless of helper-text length. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0">
                <span className="label">Type</span>
                <div className="py-1.5">
                  <Toggle checked={info.special} onChange={next => setInfo({ ...info, special: next })} label="Special tournament" size="sm" labelPosition="right" className="text-sm" />
                </div>
                <p className="muted text-xs leading-snug">Excluded from dashboard stats by default. Use for themed events.</p>
              </div>
              <div className="min-w-0">
                <span className="label">Rebuys</span>
                <div className="py-1.5">
                  <Toggle checked={info.rebuys_allowed} onChange={next => setInfo({ ...info, rebuys_allowed: next, rebuy_close_level: next ? info.rebuy_close_level : null })} label="Rebuys allowed" size="sm" labelPosition="right" className="text-sm" />
                </div>
                <p className="muted text-xs leading-snug">Whether players can rebuy. Fixed for the night — you control the open/closed window live.</p>
              </div>
              <div className="min-w-0">
                <span className="label">Add-ons</span>
                <div className="py-1.5">
                  <Toggle checked={info.addons_allowed} onChange={next => setInfo({ ...info, addons_allowed: next })} label="Add-ons allowed" size="sm" labelPosition="right" className="text-sm" />
                </div>
                <p className="muted text-xs leading-snug">One-time chip top-up, usually offered at the first break. Price and chip grant default to the buy-in and starting stack — tweak them (and this toggle) later in the console&apos;s Settings → Format &amp; players tab.</p>
              </div>
              <div className="min-w-0">
                <span className="label">Format</span>
                <div className="py-1.5">
                  <Toggle checked={info.is_pko} onChange={setPko} label="Progressive knockout (PKO)" size="sm" labelPosition="right" className="text-sm" />
                </div>
                <p className="muted text-xs leading-snug">Delayed bounties: knockouts pay cash from the bounty level on. Prize pool uses the regular buy-in only.</p>
              </div>
            </div>

            {/* Settings unlocked by the toggles above. Each enabled toggle adds
                one column (close-level for rebuys; bounty fields for PKO), so
                they line up in a single tidy row on desktop. */}
            {(info.rebuys_allowed || info.is_pko) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                {info.rebuys_allowed && (
                  <div className="min-w-0">
                    <label className="label">Close re-entries from level <span className="muted font-normal">(optional)</span></label>
                    <NumberInput
                      className="input"
                      value={info.rebuy_close_level}
                      onChange={n => setInfo({ ...info, rebuy_close_level: n })}
                      emptyBlurBehavior="null"
                      placeholder="—"
                    />
                    <p className="muted text-xs leading-snug mt-1">Auto-closes re-entries when this level starts. Leave empty to manage the window manually.</p>
                  </div>
                )}
                {info.is_pko && (
                  <>
                    <div className="min-w-0">
                      <label className="label">Starting bounty (€)</label>
                      <NumberInput className="input" allowDecimal value={info.bounty_start_amount} onChange={n => setBounty(n ?? 0)} />
                      {info.bounty_start_amount > info.buy_in_amount ? (
                        <p className="text-xs leading-snug mt-1 text-red-500">The starting bounty can&apos;t exceed the buy-in (€{info.buy_in_amount.toFixed(2)}) — it&apos;s taken from it.</p>
                      ) : (
                        <p className="muted text-xs leading-snug mt-1">Taken from the buy-in — max €{info.buy_in_amount.toFixed(2)}.</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <label className="label">Bounty phase from level</label>
                      <NumberInput className="input" value={info.bounty_start_level} onChange={n => setInfo({ ...info, bounty_start_level: n ?? 0 })} />
                      <p className="muted text-xs leading-snug mt-1">Blind level where knockouts start paying cash. Set to 0 for knockouts to award cash from the start of the tournament.</p>
                    </div>
                    <div className="min-w-0">
                      <label className="label">Bounty token (€)</label>
                      <select
                        className="input"
                        value={info.bounty_chip}
                        onChange={e => setInfo({ ...info, bounty_chip: Number(e.target.value) })}
                      >
                        {bountyChipOptions(info.bounty_start_amount).map(v => (
                          <option key={v} value={v}>€{v.toFixed(2)}</option>
                        ))}
                      </select>
                      <p className="muted text-xs leading-snug mt-1">Bounty payouts are rounded to this value.</p>
                    </div>
                    <div className="min-w-0 sm:col-span-2 md:col-span-4">
                      <p className="muted text-xs leading-snug">Of each €{info.buy_in_amount.toFixed(2)} buy-in, €{info.bounty_start_amount.toFixed(2)} becomes the player&apos;s bounty and €{Math.max(0, info.buy_in_amount - info.bounty_start_amount).toFixed(2)} goes to the prize pool. {info.bounty_start_level <= 0 ? "Knockouts pay half the bounty as cash from the start of the tournament." : `Knockouts before level ${info.bounty_start_level} just grow the hunter's bounty; from level ${info.bounty_start_level} on, half the bounty is paid as cash.`}</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h2 className="text-lg font-semibold">Payout structure</h2>
              {!info.dynamic_payouts && (
                <div className={`text-sm ${Math.abs(payoutSum - 100) > 0.01 ? "neg" : "muted"}`}>Sum: {payoutSum}%</div>
              )}
            </div>
            <div className="mb-3">
              <Toggle
                checked={info.dynamic_payouts}
                onChange={next => setInfo({ ...info, dynamic_payouts: next })}
                label="Scale paid places with entries (dynamic)"
                size="sm"
                labelPosition="right"
                className="text-sm"
              />
              <p className="muted text-xs leading-snug mt-1">
                When on, the number of paid places and their split grow with the total entries
                (starting players + rebuys). Editable later from the live manager too.
              </p>
            </div>

            {!info.dynamic_payouts ? (
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
            ) : (
              <PayoutTierEditor
                tiers={info.payout_tiers}
                onSetMin={setTierMin}
                onSetPct={setTierPct}
                onAddPlace={addTierPlace}
                onRemovePlace={removeTierPlace}
                onAddTier={addTier}
                onRemoveTier={removeTier}
                previewEntries={entries.length}
              />
            )}
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
            {entries.length} player{entries.length === 1 ? "" : "s"} · projected starting pool €{(entries.length * (info.is_pko ? Math.max(0, info.buy_in_amount - info.bounty_start_amount) : info.buy_in_amount)).toFixed(2)}
            {info.is_pko && ` · bounties €${(entries.length * info.bounty_start_amount).toFixed(2)}`}
          </div>
          {tooFewPlayers && (
            <Callout variant="warning" title="Not enough players" className="mt-3">
              The payout structure pays <strong>{paidPositions}</strong> places but only{" "}
              <strong>{entries.length}</strong> player{entries.length === 1 ? " is" : "s are"} in. Add at least{" "}
              {paidPositions - entries.length} more, or reduce the payout places, before continuing.
            </Callout>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="muted text-sm">
            Configure the blind levels, breaks and starting stack for the live clock. You can start, pause and adjust it from the live page once the tournament begins.
          </p>
          <StructureEditor ctrl={structure} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold mb-1">Seat draw <span className="muted font-normal text-sm">(optional)</span></h2>
            <p className="muted text-sm mb-3">Draw a random seating now, or skip and draw later from the live page.</p>
            <SeatDrawPanel
              players={entries.map(e => ({ player_id: e.player_id, name: e.name }))}
              onResult={r => { setDraw(r); if (r) setSkipDraw(false); }}
              defaultSeatsPerTable={info.table_size}
              onSeatsPerTableChange={n => { setInfo(prev => ({ ...prev, table_size: n })); setDraw(null); setSkipDraw(false); }}
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
          {step < 3 && (
            <button
              type="button"
              className="btn"
              onClick={next}
              disabled={(step === 1 && !enoughPlayers) || (step === 2 && !!structure.error)}
            >
              Next
            </button>
          )}
          {step === 3 && (
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
    // On mobile the four labels + arrows overflow the screen, so only the
    // active step keeps its label there (others collapse to just the numbered
    // circle); from `sm` up every label is shown. Tighter gaps/margins on
    // mobile keep the circles-and-arrows trail compact.
    <ol className="flex items-center gap-1.5 sm:gap-2 text-sm">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-2">
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold shrink-0"
              style={{
                background: active ? "var(--accent)" : done ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "var(--bg)",
                color: active ? "#fff" : "var(--text)",
                borderColor: active || done ? "transparent" : "var(--border)",
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`${active ? "font-semibold inline" : "muted hidden sm:inline"} whitespace-nowrap`}>{label}</span>
            {i < STEPS.length - 1 && <span className="muted mx-0.5 sm:mx-1">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
