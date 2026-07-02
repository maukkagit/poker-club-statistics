"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Player, Seating } from "@/lib/types";
import { apiKeys, postLiveAction, ApiError, createPlayer, invalidateAfterTournamentDelete } from "@/lib/api";
import TournamentClock from "@/components/TournamentClock";
import StructureEditor from "@/components/StructureEditor";
import { useTournamentStructure } from "@/components/useTournamentStructure";
import { DEFAULT_STARTING_STACK, defaultStructure } from "@/lib/tournament-structure";
import { useClockChannel } from "@/components/useClockChannel";
import {
  applyClockAction, buyInSubtitle, computeClockAggregates, deriveClockView, effectiveClockLevel,
  rebuyWindowAutoToggle, rowStartMs, type ClockAction,
} from "@/lib/tournament-clock";
import { computeBountyState, bountyConfig, bountyPhaseAt, splitBountyChips, formatKoCount } from "@/lib/pko";
import { computeNetPositions, simplifyDebts, type NetPosition, type Transfer } from "@/lib/settlement";
import { eur } from "@/lib/format";
import type { StructureRow } from "@/lib/types";
import {
  rebalanceSuggestion, shuffle, planBreak, incomingBigBlindSeat, freeSeats,
  type RebalanceSuggestion, type SeatAssignment, type TableSeats,
} from "@/lib/seating";
import { Toggle } from "@/components/ui/Toggle";
import NumberInput from "@/components/NumberInput";
import ConfirmDialog from "@/components/ConfirmDialog";
import PokerTable, { type TableOccupant } from "@/components/PokerTable";
import PlayerCombobox from "@/components/PlayerCombobox";
import EditTournamentDialog from "@/components/EditTournamentDialog";
import SeatDrawPanel, { type DrawResult } from "@/components/SeatDrawPanel";
import { ordinal } from "@/lib/format";
import {
  partitionEntries, buildOccupiedByTable, buildFreeSlots, buildPodium, buildLayout, buildTableViews,
  type LiveEntry, type LiveDetail, type PodiumRow,
} from "@/lib/live-tournament";

/**
 * Live tournament manager (issue #20). The dense entry form is replaced by a
 * compact director console: rebuy-window toggle, seat draw / re-draw, "Add
 * bust-out", MTT rebalancing suggestions, and Finish. Every mutation is a
 * version-checked RPC routed through {@link postLiveAction}; SWR refetches the
 * detail after each so the next call carries a fresh version.
 */
export default function LiveTournamentManager({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<LiveDetail>(apiKeys.tournament(id));
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const nameById = useMemo(() => new Map((playersData ?? []).map(p => [p.id, p.name])), [playersData]);

  // Keep this director screen in sync with clock/standings changes pushed from
  // other screens (or the same action's server broadcast). Harmless duplicate
  // refetch; safe no-op when realtime isn't configured.
  const refetchSelf = useCallback(() => { void mutate(); }, [mutate]);
  useClockChannel(data?.tournament.share_token, refetchSelf);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bustOpen, setBustOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [redrawWarn, setRedrawWarn] = useState(false);
  const tablesRef = useRef<HTMLDivElement>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  // After finishing, offer to compute the "who pays who" settlement. `null`
  // result means the prompt isn't showing; a result object opens the breakdown.
  const [settlePromptOpen, setSettlePromptOpen] = useState(false);
  const [settlement, setSettlement] = useState<{ positions: NetPosition[]; transfers: Transfer[] } | null>(null);
  // Edge-triggered rebalance dismissal keyed by the alive count that triggered.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState<RebalanceSuggestion | null>(null);
  // After breaking a table, the mapping of who moved where, shown in a dialog
  // until the director closes it.
  const [breakResult, setBreakResult] = useState<{ breakTable: number; moves: { name: string; toTable: number; toSeat: number }[] } | null>(null);
  const [dealOpen, setDealOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  // Full-tournament restart (rewind everything to just-created), distinct from
  // the clock-only `restartOpen` above.
  const [restartAllOpen, setRestartAllOpen] = useState(false);
  const [tab, setTab] = useState<LiveTab>("manage");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("basics");

  if (isLoading || !data) return <div className="muted">Loading…</div>;
  const t = data.tournament;
  const version = t.version;
  const entries = data.entries;

  const { alive, busted, seated } = partitionEntries(entries);
  const hasSeats = !!t.seating && seated.length > 0;
  const seatsPerTable = t.seating?.seats_per_table ?? 9;
  const rebuysActive = t.rebuys_allowed && t.rebuy_window_open;
  const hasDeal = !!t.payout_overrides && Object.keys(t.payout_overrides).length > 0;
  // A paid position is "locked in" once a finisher holds a position the payout
  // structure pays. While that's true, rebuys auto-close and can't be reopened
  // (the director must undo bust-outs past the bubble first).
  const paidPositions = new Set(t.payout_structure.map(s => s.position));
  const inMoneyDetermined = entries.some(e => e.finish_position != null && paidPositions.has(e.finish_position));
  // Once 1st place is decided the result is final — no more deals.
  const winnerDetermined = entries.some(e => e.finish_position === 1);
  // Finishing is only allowed once the tournament is actually decided: either a
  // single player remains (auto-crowned 1st on finish) or the winner has already
  // been crowned 1st (the final bust crowns the last survivor, leaving 0 alive).
  const canFinish = alive.length === 1 || winnerDetermined;
  // Re-drawing seats shuffles everyone — only safe before the night starts, so
  // it's offered only while nobody has rebought or busted.
  const canRedraw = busted.length === 0 && entries.every(e => e.buy_ins <= 1);

  const occupiedByTable = buildOccupiedByTable(seated);
  const totalTables = t.seating?.tables ?? 0;
  const freeSlots = buildFreeSlots(hasSeats, totalTables, occupiedByTable, seatsPerTable);
  // Late entries are only possible while the rebuy window is open AND no paid
  // position has been determined yet (the field can't grow once the money's in
  // sight). If seats are drawn we also need at least one open chair (a full
  // house can't grow).
  const canAddPlayer = rebuysActive && !inMoneyDetermined && (!hasSeats || freeSlots.length > 0);
  const enteredIds = new Set(entries.map(e => e.player_id));
  const addablePlayers = (playersData ?? []).filter(p => !enteredIds.has(p.id));

  // Prize pool = every buy-in (incl. rebuys) at the tournament's buy-in.
  const totalBuyIns = entries.reduce((s, e) => s + e.buy_ins, 0);
  const prizePool = totalBuyIns * t.buy_in_amount;

  // The amount each paid position pays right now: a deal override if set,
  // otherwise pool × pct. Used by both the always-on payouts panel/podium and
  // as the default values in the "make a deal" dialog.
  const podium = buildPodium(t.payout_structure, prizePool, t.payout_overrides, entries, nameById);

  // ---- PKO bounties ----
  // Derived (never stored): the bounty state is replayed from the knockout
  // ledger so it stays correct through undo/re-entry. Phase comes from the
  // live clock level vs. the configured bounty-start level.
  const isPko = !!t.is_pko;
  const knockouts = data.knockouts ?? [];
  const bountyView = isPko ? deriveClockView(t.structure ?? [], t.clock ?? null, Date.now()) : null;
  const bountyPhase = bountyPhaseAt(bountyView?.levelNumber ?? null, t.bounty_start_level);
  const champion = entries.find(e => e.finish_position === 1)?.player_id ?? null;
  const bountyState = isPko
    ? computeBountyState(entries.map(e => e.player_id), knockouts, bountyConfig(t), champion)
    : null;

  // Build the end-of-night settlement ("who pays who"). Finishing auto-crowns a
  // lone survivor as 1st, so we mirror that here to get the final champion (for
  // their own-bounty cash-out) and prize. Each player's net is winnings (prize +
  // bounty cash) minus their stake (buy-ins × per-entry cost, bounty included
  // for PKO); simplifyDebts then collapses those nets into the fewest transfers.
  function buildSettlement(): { positions: NetPosition[]; transfers: Transfer[] } {
    const finalized = entries.map(e => ({ ...e }));
    const stillIn = finalized.filter(e => e.finish_position == null);
    if (stillIn.length === 1) stillIn[0].finish_position = 1;
    const championId = finalized.find(e => e.finish_position === 1)?.player_id ?? null;

    const amountByPosition = new Map(podium.map(r => [r.position, r.amount]));
    const settleBounty = isPko
      ? computeBountyState(finalized.map(e => e.player_id), knockouts, bountyConfig(t), championId)
      : null;
    const perEntryCost = t.buy_in_amount + (isPko ? (t.bounty_start_amount ?? 0) : 0);

    const players = finalized.map(e => ({
      player_id: e.player_id,
      name: nameById.get(e.player_id) ?? "?",
      buyIns: e.buy_ins,
      prizeWon: e.finish_position != null ? (amountByPosition.get(e.finish_position) ?? 0) : 0,
      bountyWon: settleBounty?.byPlayer.get(e.player_id)?.cashWon ?? 0,
    }));

    const positions = computeNetPositions(players, perEntryCost);
    return { positions, transfers: simplifyDebts(positions) };
  }

  // Commit the finish (marks the tournament Finished — which unmounts this live
  // view) and return to the list. Called at the end of the settlement flow so
  // the optional settlement dialogs can run while the view is still mounted.
  async function finalizeFinish() {
    await act("finish", {});
    router.push("/tournaments");
  }

  // ---- Tournament clock (issue #21) ----
  const hasStructure = !!t.structure && t.structure.length > 0;
  const clockAggregates = computeClockAggregates(
    entries.map(e => ({ buy_ins: e.buy_ins, finish_position: e.finish_position })),
    { buyInAmount: t.buy_in_amount, startingStack: t.starting_stack },
  );
  const clockPayouts = podium.map(r => ({ position: r.position, amount: r.amount }));
  const clockStarted = !!t.clock?.started;
  const clockRunning = !!t.clock?.running && clockStarted;
  // A started-but-paused clock sitting at the very beginning (0:00) reads as
  // "Start" rather than "Resume" — e.g. right after "Restart clock".
  const clockAtStart = (t.clock?.elapsed_ms ?? 0) === 0;
  // "Play has started" — the clock has run, or anyone has busted (a bust that was
  // rebought clears finish_position but leaves buy_ins > 1, so both count). Once
  // true, the tournament's money/format/field is locked in the edit dialog.
  const playStarted = clockStarted || entries.some(e => e.finish_position != null || e.buy_ins > 1);

  // ---- Auto-close / auto-reopen re-entry window based on clock level ----
  // The window auto-closes when the clock reaches `rebuy_close_level` and
  // auto-reopens when rewound before it.
  //
  // Crucially this must NEVER fire while another version-checked action (a clock
  // edit, a bustout, …) is in flight: even though the toggle itself skips the
  // version check (expected_version omitted), it still BUMPS the row version, so
  // firing it mid-flight would make the other action's optimistic-version RPC
  // conflict ("updated elsewhere"). We therefore gate the whole evaluation on
  // `versionedActionInFlight` (a synchronous ref) and on `busy` (state, so the
  // effect re-runs the moment the action settles and the fresh clock arrives).
  const autoRebuyRunning = useRef(false);
  const versionedActionInFlight = useRef(false);
  // Last *effective* level we evaluated against, so we only act on a real
  // crossing (and so natural ticking, which doesn't change stored elapsed_ms,
  // is still picked up by re-deriving the wall-clock-aware level each tick).
  const prevEffLevelRef = useRef<number | null>(null);

  const applyRebuyAutoToggle = useCallback(async (nextOpen: boolean) => {
    if (autoRebuyRunning.current) return;
    autoRebuyRunning.current = true;
    try {
      void mutate(
        prev => (prev ? { ...prev, tournament: { ...prev.tournament, rebuy_window_open: nextOpen } } : prev),
        { revalidate: false },
      );
      // expected_version omitted: this is a system-driven toggle that should
      // win regardless of concurrent clock edits, never a user conflict.
      await postLiveAction(id, "set_rebuy_window", { open: nextOpen });
    } catch {
      void mutate();
    } finally {
      autoRebuyRunning.current = false;
    }
  }, [id, mutate]);

  // Natural clock progression: re-evaluate the wall-clock level every 2 s while
  // the clock runs (stored elapsed_ms doesn't change as it ticks, so we must
  // re-derive). Manual clock edits arrive via the refetch after `clockAct`.
  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    if (!clockRunning || t.rebuy_close_level == null || !t.rebuys_allowed) return;
    const handle = setInterval(() => setAutoTick(n => n + 1), 2000);
    return () => clearInterval(handle);
  }, [clockRunning, t.rebuy_close_level, t.rebuys_allowed]);

  useEffect(() => {
    const closeLevel = t.rebuy_close_level;
    if (!t.rebuys_allowed || closeLevel == null) {
      prevEffLevelRef.current = null;
      return;
    }
    // Don't touch the window (or advance the baseline) while a versioned action
    // is mid-flight; we'll re-run once `busy` clears with the settled clock.
    if (busy || versionedActionInFlight.current || autoRebuyRunning.current) return;

    const struct = t.structure ?? [];
    const newLevel = effectiveClockLevel(deriveClockView(struct, t.clock ?? null, Date.now()), struct);
    const prev = prevEffLevelRef.current;
    prevEffLevelRef.current = newLevel;

    // First evaluation (mount / config change): close if we're already at or
    // past the close level, otherwise just record the baseline.
    if (prev === null) {
      if (newLevel >= closeLevel && t.rebuy_window_open) void applyRebuyAutoToggle(false);
      return;
    }
    if (prev === newLevel) return;

    const nextOpen = rebuyWindowAutoToggle({
      closeLevel,
      prevLevel: prev,
      newLevel,
      windowOpen: !!t.rebuy_window_open,
      inMoneyDetermined,
    });
    if (nextOpen != null) void applyRebuyAutoToggle(nextOpen);
  // `busy` is included so the effect re-runs after an action settles; autoTick
  // drives natural re-evaluation; clock fields drive manual jumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTick, busy, t.clock?.elapsed_ms, t.clock?.running, t.clock?.started, t.clock?.updated_at,
      t.structure, t.rebuy_close_level, t.rebuy_window_open, t.rebuys_allowed, inMoneyDetermined,
      applyRebuyAutoToggle]);

  // Current physical layout (alive, seated players grouped by table in ring order).
  const layout = buildLayout(seated, seatsPerTable);

  // Signature of the per-table occupant counts. `rebalanceSuggestion` picks the
  // source table at random when several tie for the most players, so we memoise
  // on this signature: the suggestion (and its random source) stays stable
  // across re-renders and only re-rolls when the table counts actually change.
  const layoutSig = `${hasSeats ? 1 : 0}|${seatsPerTable}|${layout.tables.map(t => `${t.table_no}:${t.occupants.length}`).join(",")}`;
  const suggestion: RebalanceSuggestion = useMemo(
    () => (hasSeats ? rebalanceSuggestion(layout) : { kind: "none" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutSig],
  );
  const activeSuggestion = suggestion.kind !== "none" ? suggestion : null;
  const showRebalance = !!activeSuggestion && dismissedAt !== alive.length;

  async function act(action: string, payload: Record<string, unknown>) {
    setErr(null);
    setBusy(true);
    versionedActionInFlight.current = true;
    try {
      await postLiveAction(id, action, { expected_version: version, ...payload });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message ?? "Action failed");
    } finally {
      versionedActionInFlight.current = false;
      setBusy(false);
    }
  }

  // A late entry (added live) can be removed if added by mistake — but only
  // while they're still in and haven't been part of any knockout (as either the
  // hunter or the victim). Players who've been in since creation are never
  // removable.
  const canRemove = (e: typeof entries[number]) =>
    !!e.late_entry && e.finish_position == null &&
    !knockouts.some(k => k.eliminator_player_id === e.player_id || k.eliminated_player_id === e.player_id);

  // Clock controls feel instant: we patch the SWR cache with the locally-derived
  // next clock state (same math as the server) before the round-trip, then let
  // postLiveAction's refetch reconcile with server truth. On error we refetch to
  // roll back the optimistic patch.
  async function clockAct(clockAction: ClockAction, serverAction: string, payload: Record<string, unknown>) {
    setErr(null);
    setBusy(true);
    versionedActionInFlight.current = true;
    const optimistic = applyClockAction(t.structure ?? [], t.clock ?? null, clockAction, Date.now());
    void mutate(
      prev => (prev ? { ...prev, tournament: { ...prev.tournament, clock: optimistic } } : prev),
      { revalidate: false },
    );
    try {
      await postLiveAction(id, serverAction, { expected_version: version, ...payload });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message ?? "Action failed");
      void mutate();
    } finally {
      // Clear the in-flight gate first, then drop busy. The busy=false render
      // re-runs the auto-close effect, which now sees the settled clock (from
      // the refetch postLiveAction triggered) and closes/reopens rebuys with a
      // standalone, version-free RPC — no race with the clock action above.
      versionedActionInFlight.current = false;
      setBusy(false);
    }
  }

  // Jump to a level boundary and pause: the start of the current level
  // ("Restart level"), the start of the previous level ("Previous Level"), or
  // the start of the next level ("Next Level"). Boundaries are computed from the
  // structure client-side; the server clamps and stores the absolute position.
  function seekLevel(target: "start" | "prev" | "next") {
    const struct = t.structure ?? [];
    const view = deriveClockView(struct, t.clock ?? null, Date.now());
    if (view.rowIndex < 0 || !struct[view.rowIndex]) return;
    const targetIndex =
      target === "start" ? view.rowIndex
        : target === "prev" ? Math.max(0, view.rowIndex - 1)
          : view.rowIndex + 1;
    const elapsedMs = rowStartMs(struct, targetIndex);
    void clockAct(
      { type: "setElapsed", elapsedMs, running: false },
      "set_clock_elapsed",
      { elapsed_ms: elapsedMs, running: false },
    );
  }

  async function saveStructure(structure: StructureRow[], startingStack: number) {
    setErr(null);
    setBusy(true);
    void mutate(
      prev => (prev ? { ...prev, tournament: { ...prev.tournament, structure, starting_stack: startingStack } } : prev),
      { revalidate: false },
    );
    try {
      await postLiveAction(id, "set_structure", { expected_version: version, structure, starting_stack: startingStack });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message ?? "Action failed");
      void mutate();
    } finally {
      setBusy(false);
    }
  }

  // Persist edits from the "Edit tournament" dialog. Rethrows so the dialog can
  // surface the error and stay open; on success we revalidate to pick up the new
  // version and any roster/seating changes.
  async function saveTournamentInfo(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await postLiveAction(id, "update_tournament_info", { expected_version: version, patch });
      await mutate();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message ?? "Action failed";
      void mutate();
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  // ---- Tables for visualization (occupants at their real physical seats) ----
  const tableViews = buildTableViews(occupiedByTable, seated, nameById);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary mr-auto"
          onClick={() => router.push("/tournaments")}
          title="Everything is saved automatically — this just returns to the tournaments list"
        >
          Save &amp; close
        </button>
        <button
          type="button"
          className={canFinish ? "btn" : "btn btn-secondary"}
          disabled={busy || !canFinish}
          title={canFinish ? "Finish and include in stats" : "You can only finish once a single player is left (the winner)"}
          onClick={() => setFinishOpen(true)}
        >
          Finish tournament
        </button>
      </div>

      {err && <div className="card neg">{err}</div>}

      <TabBar tab={tab} setTab={setTab} rebalanceDue={showRebalance && !!activeSuggestion} />

      {tab === "manage" && (
        <>
      {/* Tournament clock + director controls */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Tournament clock</h2>
          {t.share_token && <CopyViewerLink token={t.share_token} />}
        </div>
        {hasStructure ? (
          <>
            <div
              className="max-w-2xl mx-auto rounded-xl border-2 p-2 sm:p-3 shadow-lg"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              <TournamentClock
                title={t.display_name ?? "Tournament clock"}
                subtitle={buyInSubtitle({
                  // Show the total entry price. For PKO the stored buy_in_amount
                  // is only the prize-pool part, so add the bounty back on.
                  buyInAmount: isPko ? t.buy_in_amount + (t.bounty_start_amount ?? 0) : t.buy_in_amount,
                  rebuysAllowed: t.rebuys_allowed,
                  rebuyWindowOpen: t.rebuy_window_open,
                })}
                structure={t.structure ?? []}
                clock={t.clock ?? null}
                aggregates={clockAggregates}
                payouts={clockPayouts}
                prizePoolDisplay={isPko ? clockAggregates.prizePool + clockAggregates.totalBuyIns * (t.bounty_start_amount ?? 0) : null}
                payoutsLabel={isPko ? "Payouts (excl. bounties)" : undefined}
                hideHeading
                hideTopBar
                hideLiveStatus
                bounty={isPko && bountyState ? {
                  leader: bountyState.leader
                    ? {
                        name: nameById.get(bountyState.leader.player_id) ?? "?",
                        koCount: bountyState.leader.koCount,
                        cashWon: bountyState.leader.cashWon,
                      }
                    : null,
                  totalCashPaid: bountyState.totalCashPaid,
                  inPlay: Math.max(
                    0,
                    clockAggregates.totalBuyIns * (t.bounty_start_amount ?? 0) - bountyState.totalCashPaid,
                  ),
                } : null}
              />
            </div>

            {/* Clock control keypad — sits under the preview so every director
                action shares one tidy, uniform grid of keys. */}
            <div className="clock-pad grid grid-cols-3 gap-2 max-w-2xl mx-auto w-full">
              {!clockStarted ? (
                <PadKey
                  wide
                  variant="primary"
                  label="Start clock"
                  title="Start the tournament clock"
                  disabled={busy}
                  onClick={() => clockAct({ type: "start" }, "start_clock", {})}
                  icon={<KeyIcon><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" /></KeyIcon>}
                />
              ) : (
                <>
                  <PadKey
                    label="Prev level"
                    title="Jump to the start of the previous level and pause"
                    disabled={busy}
                    onClick={() => seekLevel("prev")}
                    icon={<KeyIcon><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" /></KeyIcon>}
                  />
                  <PadKey
                    label="Restart level"
                    title="Jump back to the start of the current level and pause"
                    disabled={busy}
                    onClick={() => seekLevel("start")}
                    icon={<KeyIcon><path d="M1 4v6h6" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" /></KeyIcon>}
                  />
                  <PadKey
                    label="Next level"
                    title="Jump to the start of the next level and pause"
                    disabled={busy}
                    onClick={() => seekLevel("next")}
                    icon={<KeyIcon><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></KeyIcon>}
                  />

                  <PadKey
                    label="−1:00"
                    title="Rewind 1 minute"
                    disabled={busy}
                    onClick={() => clockAct({ type: "adjust", deltaMs: -60_000 }, "adjust_clock", { delta_ms: -60_000 })}
                    icon={<KeyIcon><line x1="5" y1="12" x2="19" y2="12" /></KeyIcon>}
                  />
                  {clockRunning ? (
                    <PadKey
                      variant="primary"
                      label="Pause"
                      title="Pause the clock"
                      disabled={busy}
                      onClick={() => clockAct({ type: "setRunning", running: false }, "set_clock_running", { running: false })}
                      icon={<KeyIcon><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></KeyIcon>}
                    />
                  ) : (
                    <PadKey
                      variant="primary"
                      label={clockAtStart ? "Start" : "Resume"}
                      title={clockAtStart ? "Start the clock" : "Resume the clock"}
                      disabled={busy}
                      onClick={() => clockAct({ type: "setRunning", running: true }, "set_clock_running", { running: true })}
                      icon={<KeyIcon><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" /></KeyIcon>}
                    />
                  )}
                  <PadKey
                    label="+1:00"
                    title="Fast-forward 1 minute"
                    disabled={busy}
                    onClick={() => clockAct({ type: "adjust", deltaMs: 60_000 }, "adjust_clock", { delta_ms: 60_000 })}
                    icon={<KeyIcon><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></KeyIcon>}
                  />

                  <PadKey
                    wide
                    variant="danger"
                    label="Restart clock"
                    title="Restart the clock from level 1"
                    disabled={busy}
                    onClick={() => setRestartOpen(true)}
                    icon={<KeyIcon><path d="M23 4v6h-6" /><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" /></KeyIcon>}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <p className="muted text-sm">No clock structure was configured for this tournament.</p>
        )}
      </div>

      {/* Status + rebuy window + primary actions */}
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Controls</h2>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <span className="text-sm muted">{alive.length} alive · {entries.length} entrants · {totalBuyIns} buyins</span>
          {t.rebuys_allowed ? (
            <div className="flex flex-col items-end gap-0.5">
              <Toggle
                checked={t.rebuy_window_open}
                onChange={next => act("set_rebuy_window", { open: next })}
                label={t.rebuy_window_open ? "Rebuys open" : "Rebuys closed"}
                size="sm"
                labelPosition="right"
                className="text-sm"
                disabled={busy || (inMoneyDetermined && !t.rebuy_window_open)}
              />
              {inMoneyDetermined && !t.rebuy_window_open && (
                <span className="text-xs muted">Locked — undo bustouts past the money to reopen</span>
              )}
            </div>
          ) : (
            <span className="text-xs muted">Rebuys not allowed</span>
          )}
        </div>
        <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className={`clock-pad grid grid-cols-2 gap-2 ${rebuysActive ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <PadKey
              variant="primary"
              label="Add bustout"
              title="Record a player busting out"
              disabled={busy || alive.length === 0}
              onClick={() => setBustOpen(true)}
              icon={<KeyIcon><circle cx="9" cy="7" r="4" /><path d="M3 21v-1a6 6 0 0 1 6-6h0" /><line x1="15" y1="11" x2="22" y2="11" /></KeyIcon>}
            />
            <PadKey
              label="Undo bustout"
              title="Undo the most recent bustout — puts the player back in their seat, reverts any rebalancing done since, and (in PKO) gives back the bounty cash and heads. Click again to keep undoing earlier bustouts one at a time."
              disabled={busy || (busted.length === 0 && clockAggregates.reEntries === 0)}
              onClick={() => act("undo_latest_bust", {})}
              icon={<KeyIcon><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></KeyIcon>}
            />
            {rebuysActive && (
              <PadKey
                label="Add player"
                title={hasSeats && freeSlots.length === 0 ? "No open seats — can't add a player" : "Add a late-arriving player"}
                disabled={busy || !canAddPlayer}
                onClick={() => setAddOpen(true)}
                icon={<KeyIcon><circle cx="9" cy="7" r="4" /><path d="M3 21v-1a6 6 0 0 1 6-6h0" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></KeyIcon>}
              />
            )}
            <PadKey
              label={hasDeal ? "Edit deal" : "Make a deal"}
              title={winnerDetermined ? "The winner is decided — deals are closed" : "Override the payout per finishing position"}
              disabled={busy || winnerDetermined}
              onClick={() => setDealOpen(true)}
              icon={<KeyIcon><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></KeyIcon>}
            />
          </div>
          {hasDeal && <p className="text-xs font-semibold mt-2" style={{ color: "rgb(251 191 36)" }}>Deal applied</p>}
        </div>
        {rebuysActive && hasSeats && freeSlots.length === 0 && (
          <p className="muted text-xs">All seats are full — break or rebalance a table to free a seat before adding a player.</p>
        )}
      </div>

      {/* Rebalance suggestion banner */}
      {showRebalance && activeSuggestion && (
        <div className="card" style={{ borderColor: "rgb(251 191 36 / 0.5)", background: "rgb(251 191 36 / 0.08)" }}>
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="text-sm">
              <span className="font-semibold">Rebalance due.</span> {activeSuggestion.reason}
            </div>
            <div className="flex gap-2">
              {activeSuggestion.kind === "move" && (
                <button className="btn" disabled={busy} onClick={() => setMoveOpen(activeSuggestion)}>Move a player…</button>
              )}
              {activeSuggestion.kind === "break" && (
                <button className="btn" disabled={busy} onClick={() => doBreak(activeSuggestion.breakTable)}>Break table {activeSuggestion.breakTable}</button>
              )}
              {activeSuggestion.kind === "final" && (
                <button className="btn" disabled={busy} onClick={() => doFinalTable(activeSuggestion.intoTable)}>Form final table</button>
              )}
              <button className="btn btn-secondary" disabled={busy} onClick={() => setDismissedAt(alive.length)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Seating */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-lg font-semibold">Seating</h2>
          <div className="flex items-center gap-1.5">
            {hasSeats && (
              <ShareTablesButton
                targetRef={tablesRef}
                title={t.name?.trim() ? t.name : "Poker tournament"}
                subtitle={`${tableViews.length} table${tableViews.length === 1 ? "" : "s"} · ${alive.length} player${alive.length === 1 ? "" : "s"}`}
              />
            )}
            {hasSeats ? (
              canRedraw
                ? <button className="btn btn-secondary text-sm" disabled={busy} onClick={() => setRedrawWarn(true)}>Re-draw seats</button>
                : <span className="text-xs muted">Locked — play has started</span>
            ) : (
              <button className="btn text-sm" disabled={busy || alive.length < 2} onClick={() => setDrawOpen(true)}>Draw seats</button>
            )}
          </div>
        </div>
        {hasSeats ? (
          <div ref={tablesRef} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {tableViews.map((tv, i) => {
              // Odd table out: span both columns and center it at one column's width.
              const centerLast = tableViews.length % 2 === 1 && i === tableViews.length - 1;
              return (
                <div key={tv.table_no} className={centerLast ? "lg:col-span-2 lg:w-1/2 lg:justify-self-center" : undefined}>
                  <PokerTable
                    tableNo={tv.table_no}
                    occupants={tv.occupants}
                    seats={t.seating?.seats_per_table ?? null}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted text-sm">No seats assigned. Bustouts and rebuys still work — draw seats whenever you like to enable table rebalancing.</p>
        )}
      </div>
        </>
      )}

      {tab === "players" && (
        <>
      {/* Players / standings */}
      <div className="card card-flat">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold">Players</h2>
          {isPko && (
            <span className={`text-xs rounded-full px-2 py-0.5 ${bountyPhase === "bounty" ? "bg-[var(--accent)] text-black" : "muted border border-[var(--border)]"}`}>
              {bountyPhase === "bounty" ? "Bounty phase — cash live" : `Pre-bounty (cash from level ${t.bounty_start_level ?? "?"})`}
            </span>
          )}
        </div>
        <div className="space-y-4">
          {/* Still-in table */}
          <div>
            <h3 className="text-sm font-semibold muted mb-2">Still in ({alive.length})</h3>
            {alive.length === 0 ? (
              <p className="muted text-sm">Nobody left in.</p>
            ) : (
              <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
                <table className="table table-fixed whitespace-nowrap" style={{ minWidth: isPko ? "40rem" : "17rem" }}>
                  <PlayerCols isPko={isPko} />
                  <StandingsHead isPko={isPko} />
                  <tbody>
                    {alive.map(e => {
                      const b = isPko ? bountyState?.byPlayer.get(e.player_id) : null;
                      return (
                        <tr key={e.player_id}>
                          <td className={`text-center muted ${stickyPlace}`} style={STICKY_BG}>—</td>
                          <td className={stickyPlayer} style={stickyPlayerStyle}>
                            <span className="inline-flex items-center gap-1.5">
                              {nameById.get(e.player_id) ?? "?"}
                              {canRemove(e) && (
                                <button
                                  type="button"
                                  className="leading-none text-xs w-4 h-4 rounded-full border border-[var(--border)] muted hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-40"
                                  disabled={busy}
                                  title="Remove this late entry (added by mistake)"
                                  aria-label={`Remove ${nameById.get(e.player_id) ?? "player"}`}
                                  onClick={() => setRemoveTarget(e.player_id)}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          </td>
                          <td className="text-center">{e.buy_ins}</td>
                          <td className="text-right muted">—</td>
                          {isPko && (
                            <>
                              <td className="text-right">{eur(b?.cashWon ?? 0)}</td>
                              <td className="text-right">{eur(e.payout + (b?.cashWon ?? 0))}</td>
                              <td className="text-right">{eur(b?.current ?? 0)}</td>
                              <td className="text-center">{formatKoCount(b?.koCountPre ?? 0)}</td>
                              <td className="text-center">{formatKoCount(b?.koCountBounty ?? 0)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Busted table */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h3 className="text-sm font-semibold muted">Busted ({busted.length})</h3>
            </div>
            {busted.length === 0 ? (
              <p className="muted text-sm">No bustouts yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
                <table className="table table-fixed whitespace-nowrap" style={{ minWidth: isPko ? "40rem" : "17rem" }}>
                  <PlayerCols isPko={isPko} />
                  <StandingsHead isPko={isPko} />
                  <tbody>
                    {busted.map(e => {
                      const b = isPko ? bountyState?.byPlayer.get(e.player_id) : null;
                      return (
                        <tr key={e.player_id}>
                          <td className={`text-center ${stickyPlace}`} style={STICKY_BG}>{ordinal(e.finish_position!)}</td>
                          <td className={stickyPlayer} style={stickyPlayerStyle}>{nameById.get(e.player_id) ?? "?"}</td>
                          <td className="text-center">{e.buy_ins}</td>
                          <td className="text-right">{isPko ? eur(e.payout) : (e.payout > 0 ? eur(e.payout) : "—")}</td>
                          {isPko && (
                            <>
                              <td className="text-right">{eur(b?.cashWon ?? 0)}</td>
                              <td className="text-right">{eur(e.payout + (b?.cashWon ?? 0))}</td>
                              <td className="text-right">{eur(b?.current ?? 0)}</td>
                              <td className="text-center">{formatKoCount(b?.koCountPre ?? 0)}</td>
                              <td className="text-center">{formatKoCount(b?.koCountBounty ?? 0)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
        </>
      )}

      {tab === "settings" && (
        <>
          <SettingsTabBar tab={settingsTab} setTab={setSettingsTab} />

          {settingsTab === "viewer" && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold">Display &amp; sound</h2>
            {t.share_token ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <Toggle
                    checked={t.sound_enabled ?? true}
                    onChange={next => act("set_sound", { enabled: next, knockouts: t.sound_knockouts_enabled ?? true })}
                    label={(t.sound_enabled ?? true) ? "Clock sounds on" : "Clock sounds off"}
                    size="sm"
                    labelPosition="right"
                    className="text-sm"
                    disabled={busy}
                  />
                  <Toggle
                    checked={(t.sound_enabled ?? true) && (t.sound_knockouts_enabled ?? true)}
                    onChange={next => act("set_sound", { enabled: t.sound_enabled ?? true, knockouts: next })}
                    label="Announce knockouts"
                    size="sm"
                    labelPosition="right"
                    className="text-sm"
                    disabled={busy || !(t.sound_enabled ?? true)}
                  />
                  <Toggle
                    checked={t.title_gradient_enabled ?? true}
                    onChange={next => act("set_title_gradient", { enabled: next })}
                    label="Animated title & prizes"
                    size="sm"
                    labelPosition="right"
                    className="text-sm"
                    disabled={busy}
                  />
                </div>
                <p className="muted text-xs leading-snug">Sound effects play on the viewer link only. Each viewer also taps the speaker icon to allow audio.</p>
              </div>
            ) : (
              <p className="muted text-sm">No viewer link is configured for this tournament.</p>
            )}
          </div>
          )}

          {settingsTab === "basics" && (
            <EditTournamentDialog
              inline
              section="basics"
              tournament={t}
              roster={alive.concat(busted).map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?" }))}
              playStarted={playStarted}
              busy={busy}
              onSave={saveTournamentInfo}
              onRequestRestart={() => setRestartAllOpen(true)}
            />
          )}

          {settingsTab === "format" && (
            <EditTournamentDialog
              inline
              section="format"
              tournament={t}
              roster={alive.concat(busted).map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?" }))}
              playStarted={playStarted}
              busy={busy}
              onSave={saveTournamentInfo}
              onRequestRestart={() => setRestartAllOpen(true)}
            />
          )}

          {settingsTab === "structure" && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold">{hasStructure ? "Edit blind structure" : "Add blind structure"}</h2>
            <EditStructureDialog
              inline
              initialStructure={t.structure ?? null}
              initialStartingStack={t.starting_stack ?? null}
              busy={busy}
              onSave={saveStructure}
            />
          </div>
          )}

          {settingsTab === "danger" && (
          <div className="card space-y-3">
            <h2 className="text-lg font-semibold neg">Danger zone</h2>
            <p className="muted text-sm">Restarting rewinds all live progress back to the initial setup. Deleting removes the tournament permanently.</p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-secondary"
                disabled={busy || deleting}
                title="Rewind all live progress (clock, bustouts, rebuys, seating) back to the just-created state"
                onClick={() => setRestartAllOpen(true)}
              >
                Restart tournament
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || deleting}
                title="Permanently delete this tournament"
                onClick={() => setDeleteOpen(true)}
              >
                {deleting ? "Deleting…" : "Delete tournament"}
              </button>
            </div>
          </div>
          )}
        </>
      )}

      {/* ---- Dialogs ---- */}
      {removeTarget && (
        <Modal title="Remove player?" onClose={() => setRemoveTarget(null)}>
          <p className="text-sm">
            Remove <span className="font-semibold">{nameById.get(removeTarget) ?? "this player"}</span> from
            the tournament? Use this only to undo a player added by mistake — it drops their buy-in from
            the prize pool and frees their seat.
          </p>
          <div className="flex gap-2 flex-wrap mt-4">
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => { const pid = removeTarget; setRemoveTarget(null); await act("remove_player", { player_id: pid }); }}
            >
              Remove player
            </button>
            <button className="btn btn-secondary ml-auto" disabled={busy} onClick={() => setRemoveTarget(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {bustOpen && (
        <BustDialog
          alive={alive.map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?", table_no: e.table_no ?? null }))}
          rebuysActive={rebuysActive}
          busy={busy}
          isPko={isPko}
          bountyPhase={bountyPhase}
          roundTo={bountyConfig(t).roundTo}
          headFor={(pid) => bountyState?.byPlayer.get(pid)?.current ?? bountyConfig(t).startAmount}
          onClose={() => setBustOpen(false)}
          onBust={async (pid, eliminatorIds) => { await act("record_bust", { player_id: pid, eliminator_player_ids: eliminatorIds }); setBustOpen(false); }}
          onRebuy={async (pid, eliminatorIds) => { await act("record_buyin", { player_id: pid, eliminator_player_ids: eliminatorIds }); setBustOpen(false); }}
        />
      )}

      {drawOpen && (
        <DrawDialog
          title="Draw seats"
          players={alive.map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?", bucket: e.bucket }))}
          busy={busy}
          onClose={() => setDrawOpen(false)}
          onConfirm={async r => { await act("assign_seats", { seating: r.seating, assignments: r.assignments }); setDrawOpen(false); }}
        />
      )}

      <ConfirmDialog
        open={redrawWarn}
        title="Re-draw seats?"
        message="This discards the current seating and randomly re-seats everyone still in. The button positions reset."
        confirmLabel="Re-draw"
        cancelLabel="Keep current"
        busy={busy}
        onCancel={() => setRedrawWarn(false)}
        onConfirm={() => { setRedrawWarn(false); setDrawOpen(true); }}
      />

      {moveOpen?.kind === "move" && (
        <MoveDialog
          suggestion={moveOpen}
          tableViews={tableViews}
          seatsPerTable={seatsPerTable}
          busy={busy}
          onClose={() => setMoveOpen(null)}
          onConfirm={async (moverId, toTable, toSeat) => {
            if (toSeat == null) { setErr("That table is full."); return; }
            // Button positions are no longer tracked for display, so we don't
            // pin the source button.
            await act("rebalance_move", { player_id: moverId, to_table: toTable, to_seat: toSeat, from_button_seat: null });
            setMoveOpen(null);
          }}
        />
      )}

      {breakResult && (
        <Modal title={`Table ${breakResult.breakTable} broken`} onClose={() => setBreakResult(null)}>
          <p className="muted text-sm mb-3">
            Table {breakResult.breakTable} is broken up. Move these players to their new seats:
          </p>
          {breakResult.moves.length === 0 ? (
            <p className="muted text-sm">No players to move.</p>
          ) : (
            <ul className="space-y-1.5">
              {breakResult.moves.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">{m.name}</span>
                  <span className="muted">Table {breakResult.breakTable} → Table {m.toTable}, seat {m.toSeat}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end mt-4">
            <button className="btn" onClick={() => setBreakResult(null)}>Close</button>
          </div>
        </Modal>
      )}

      {addOpen && (
        <AddPlayerDialog
          addable={addablePlayers}
          seatInfo={hasSeats ? { open: freeSlots.length } : null}
          busy={busy}
          onClose={() => setAddOpen(false)}
          onAddExisting={onAddPlayer}
          onCreateAndAdd={createAndAddPlayer}
        />
      )}

      {dealOpen && (
        <DealDialog
          rows={podium}
          prizePool={prizePool}
          aliveCount={alive.length}
          hasDeal={hasDeal}
          busy={busy}
          onClose={() => setDealOpen(false)}
          onSave={async overrides => { await act("set_deal", { overrides }); setDealOpen(false); }}
          onClear={async () => { await act("set_deal", { overrides: null }); setDealOpen(false); }}
        />
      )}

      <ConfirmDialog
        open={restartOpen}
        title="Restart the clock?"
        message="This resets the clock back to Level 1 at 0:00, paused. Press Start when you're ready. The elapsed time is lost and this can't be undone."
        confirmLabel="Restart clock"
        cancelLabel="Keep current"
        destructive
        busy={busy}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => { setRestartOpen(false); void clockAct({ type: "setElapsed", elapsedMs: 0, running: false }, "set_clock_elapsed", { elapsed_ms: 0, running: false }); }}
      />

      <ConfirmDialog
        open={finishOpen}
        title="Finish this tournament?"
        message="This marks the tournament Finished and includes it in the stats. Finishing positions become final."
        confirmLabel="Finish"
        cancelLabel="Keep playing"
        busy={busy}
        onCancel={() => setFinishOpen(false)}
        // Don't finish (and unmount this live view) yet — first walk through the
        // optional settlement flow, computed from the now-decided standings, then
        // finalizeFinish() writes the finish and navigates away.
        onConfirm={() => { setFinishOpen(false); setSettlePromptOpen(true); }}
      />

      <ConfirmDialog
        open={settlePromptOpen}
        title="Calculate the settlement?"
        message="Work out who pays who — the fewest direct transfers that settle every buy-in, payout and bounty for the night."
        confirmLabel="Yes, calculate"
        cancelLabel="No thanks"
        onCancel={() => { setSettlePromptOpen(false); void finalizeFinish(); }}
        onConfirm={() => { setSettlement(buildSettlement()); setSettlePromptOpen(false); }}
      />

      <ConfirmDialog
        open={!!settlement}
        title="Settlement"
        hideCancel
        confirmLabel="Done"
        message={settlement ? <SettlementBreakdown {...settlement} /> : null}
        onCancel={() => { setSettlement(null); void finalizeFinish(); }}
        onConfirm={() => { setSettlement(null); void finalizeFinish(); }}
      />

      <ConfirmDialog
        open={restartAllOpen}
        title="Restart the whole tournament?"
        message={
          <>
            This rewinds the tournament all the way back to how it was created and
            <strong> undoes everything that has happened since</strong>: the clock is
            reset, the seat draw is cleared, and every bust-out, re-entry, rebalance,
            deal, late entry and chat message is discarded.
            <br />
            <br />
            The setup is kept (structure, blinds, starting stack, payouts, buy-in and
            any PKO settings) and the original players go back to a single buy-in,
            unseated. <strong>This can&apos;t be undone.</strong>
          </>
        }
        confirmLabel="Restart tournament"
        cancelLabel="Keep playing"
        destructive
        busy={busy}
        onCancel={() => setRestartAllOpen(false)}
        onConfirm={restartEntireTournament}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this tournament?"
        message="This permanently deletes the tournament and all of its entries and seating. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteTournament}
      />
    </div>
  );

  async function restartEntireTournament() {
    await act("restart_tournament", {});
    // Clear any edge-triggered UI (rebalance dismissal, open dialogs) so the
    // freshly-reset tournament starts from a clean slate.
    setDismissedAt(null);
    setRestartAllOpen(false);
  }

  async function deleteTournament() {
    setErr(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      await invalidateAfterTournamentDelete(id);
      router.push("/tournaments");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message ?? "Failed to delete");
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  // ---- Late-entry helpers ----
  // Seat the late entrant in a random open chair (or unseated when no seating
  // has been drawn yet), then add them via the version-checked RPC.
  async function onAddPlayer(playerId: string) {
    let slot: { table_no: number; seat_no: number } | null = null;
    if (hasSeats) {
      if (freeSlots.length === 0) { setErr("No open seats — can't add a player."); return; }
      slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
    }
    await act("add_player", { player_id: playerId, table_no: slot?.table_no ?? null, seat_no: slot?.seat_no ?? null });
    setAddOpen(false);
  }
  async function createAndAddPlayer(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const p = await createPlayer(trimmed);
      await onAddPlayer(p.id);
    } catch {
      setErr("Failed to create player");
    }
  }

  // ---- Rebalance action helpers ----
  async function doBreak(breakTableNo: number) {
    const brokenPlayers = seated.filter(e => e.table_no === breakTableNo).map(e => e.player_id);
    const remaining: TableSeats[] = [...occupiedByTable.entries()]
      .filter(([tno]) => tno !== breakTableNo)
      .map(([table_no, occupied]) => ({ table_no, occupied }));
    // Random open seats on the remaining tables (balanced table choice).
    const assignments = planBreak(brokenPlayers, remaining, seatsPerTable, () => Math.random());
    await act("break_table", { break_table: breakTableNo, assignments });
    // Show the director where each broken-table player moved.
    const moves = assignments
      .map(a => ({ name: nameById.get(a.player_id) ?? "?", toTable: a.table_no, toSeat: a.seat_no }))
      .sort((a, b) => a.toTable - b.toTable || a.toSeat - b.toSeat);
    setBreakResult({ breakTable: breakTableNo, moves });
  }
  async function doFinalTable(intoTable: number) {
    // Collapse every alive seated player onto one table with a fresh random
    // seat draw (final-table seats are always redrawn, never carried over).
    const ordered = shuffle(layout.tables.flatMap(tbl => tbl.occupants), () => Math.random());
    const assignments: SeatAssignment[] = ordered.map((pid, i) => ({ player_id: pid, table_no: intoTable, seat_no: i + 1 }));
    const seating: Seating = {
      tables: 1,
      seats_per_table: t.seating?.seats_per_table ?? Math.max(2, ordered.length),
      buckets_used: t.seating?.buckets_used ?? false,
      buttons: { [String(intoTable)]: 1 },
      drawn_at: new Date().toISOString(),
    };
    await act("assign_seats", { seating, assignments });
  }
}

/**
 * End-of-night settlement breakdown shown after finishing: the minimal set of
 * direct payments ("who pays who"), plus a per-player net summary (staked vs.
 * won). Rendered inside the generic ConfirmDialog, so it keeps to a compact,
 * scrollable column.
 */
function SettlementBreakdown({ positions, transfers }: { positions: NetPosition[]; transfers: Transfer[] }) {
  const owed = [...positions].sort((a, b) => b.net - a.net);
  return (
    <div className="space-y-4 text-[var(--fg)]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide muted mb-1">Payments</div>
        {transfers.length === 0 ? (
          <p className="text-sm">Everyone&apos;s even — no payments needed.</p>
        ) : (
          <ul className="space-y-1 max-h-56 overflow-y-auto">
            {transfers.map((tr, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{tr.fromName}</span>
                  <span className="muted"> pays </span>
                  <span className="font-semibold">{tr.toName}</span>
                </span>
                <span className="tabular-nums font-semibold shrink-0">{eur(tr.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide muted mb-1">Net result</div>
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {owed.map(p => (
            <li key={p.player_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{p.name}</span>
              <span
                className="tabular-nums shrink-0"
                style={{ color: p.net > 0 ? "var(--accent)" : p.net < 0 ? "rgb(248 113 113)" : "var(--muted)" }}
              >
                {p.net > 0 ? "+" : ""}{eur(p.net)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * "Make a deal" — override the payout per finishing position. Defaults to the
 * current amounts; the total must equal the prize pool exactly before it can
 * be saved (the server re-checks this too). Saving stores a position→euro map
 * that overrides the percentage split; clearing reverts to the % structure.
 *
 * A deal is negotiated among the players still alive: they will finish in the
 * top `aliveCount` places, so only those positions are editable. Lower places
 * are already decided (a player has busted into them) or can never be paid, so
 * they're locked to their % amount and you redistribute around them.
 */
function DealDialog({
  rows, prizePool, aliveCount, hasDeal, busy, onClose, onSave, onClear,
}: {
  rows: PodiumRow[];
  prizePool: number;
  aliveCount: number;
  hasDeal: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (overrides: Record<string, number>) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const isLocked = (position: number) => position > aliveCount;
  const [amounts, setAmounts] = useState<Record<number, number>>(
    () => Object.fromEntries(rows.map(r => [
      r.position,
      // Locked positions always sit at their % amount.
      Math.round((isLocked(r.position) ? r.originalAmount : r.amount) * 100) / 100,
    ])),
  );
  const total = rows.reduce((s, r) => s + (amounts[r.position] ?? 0), 0);
  const diff = total - prizePool;
  const balanced = Math.abs(diff) < 0.01;
  const anyLocked = rows.some(r => isLocked(r.position));

  return (
    <Modal title="Make a deal" onClose={onClose}>
      <p className="muted text-sm mb-3">
        Set the euro amount each finishing position pays. The total must equal the prize pool
        (€{prizePool.toFixed(2)}).
      </p>
      <ul className="space-y-2">
        {rows.map(r => {
          const locked = isLocked(r.position);
          return (
            <li key={r.position} className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
                {r.position}
              </span>
              <span className={r.player_id ? "text-sm flex-1 truncate" : "text-sm flex-1 truncate muted"}>
                {r.player_id ? r.name : locked ? "Already decided — locked to %" : "Not decided yet"}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="muted text-sm">€</span>
                {locked ? (
                  <div className="input w-28 text-right" aria-readonly style={{ opacity: 0.7 }}>
                    {(amounts[r.position] ?? 0).toFixed(2)}
                  </div>
                ) : (
                  <NumberInput
                    className="input w-28 text-right"
                    allowDecimal
                    value={amounts[r.position] ?? 0}
                    onChange={n => setAmounts(prev => ({ ...prev, [r.position]: n ?? 0 }))}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {anyLocked && (
        <p className="muted text-xs mt-2">
          Only the top {aliveCount} place{aliveCount === 1 ? "" : "s"} (the player{aliveCount === 1 ? "" : "s"} still in) can be
          dealt. Lower places are already decided or can&apos;t be paid, so they&apos;re locked to the percentage split.
        </p>
      )}

      <div className="flex items-center justify-between mt-4 text-sm">
        <span className="muted">Total</span>
        <span className={balanced ? "font-semibold pos" : "font-semibold neg"}>
          €{total.toFixed(2)}
          {!balanced && <span className="ml-2">({diff > 0 ? "+" : ""}€{diff.toFixed(2)})</span>}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap mt-4">
        <button
          className="btn"
          disabled={busy || !balanced}
          onClick={() => {
            // Persist only the positions that deviate from the % split; if a
            // "deal" matches the structure exactly it's really no deal at all.
            // Locked positions equal their % amount, so they never make the cut.
            const sparse: Record<string, number> = {};
            for (const r of rows) {
              const v = amounts[r.position] ?? 0;
              if (Math.abs(v - r.originalAmount) > 0.01) sparse[String(r.position)] = v;
            }
            if (Object.keys(sparse).length === 0) return onClear();
            return onSave(sparse);
          }}
        >
          Save deal
        </button>
        {hasDeal && (
          <button className="btn btn-secondary" disabled={busy} onClick={onClear}>Clear deal</button>
        )}
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/**
 * Read-only viewer link for the projector clock. Copies the absolute
 * `/clock/{token}` URL to the clipboard and opens it in a new tab. The token is
 * a public, unguessable handle, so the link is safe to share without login.
 */
type LiveTab = "manage" | "players" | "settings";
type SettingsTab = "basics" | "format" | "structure" | "viewer" | "danger";

function SettingsTabBar({ tab, setTab }: {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
}) {
  const tabs: [SettingsTab, string][] = [
    ["basics", "Basic info"],
    ["format", "Format & players"],
    ["structure", "Structure"],
    ["viewer", "Display & sound"],
    ["danger", "Danger zone"],
  ];
  return (
    <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
      {tabs.map(([key, label]) => {
        const active = tab === key;
        const danger = key === "danger";
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(key)}
            className="px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
            style={{
              borderColor: active ? (danger ? "var(--danger)" : "var(--accent)") : "transparent",
              color: active ? (danger ? "var(--danger)" : "var(--text)") : "var(--muted)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TabBar({ tab, setTab, rebalanceDue }: {
  tab: LiveTab;
  setTab: (t: LiveTab) => void;
  rebalanceDue: boolean;
}) {
  const tabs: [LiveTab, string][] = [
    ["manage", "Manage"],
    ["players", "Players"],
    ["settings", "Settings"],
  ];
  return (
    <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
      {tabs.map(([key, label]) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(key)}
            className="px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors"
            style={{
              borderColor: active ? "var(--accent)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
            }}
          >
            {label}
            {key === "manage" && rebalanceDue && (
              <span
                className="ml-1.5 inline-block w-2 h-2 rounded-full align-middle"
                style={{ background: "rgb(251 191 36)" }}
                title="Table rebalance suggested"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Uniform 24×24 stroke icon used by the clock keypad keys. */
function KeyIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** A single keypad-style clock control: stacked icon + label, uniform sizing,
 *  with default / primary (play-pause) / danger (restart) palettes. */
function PadKey({
  onClick, disabled, title, label, icon, variant = "default", wide = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "primary" | "danger";
  wide?: boolean;
}) {
  const palette: React.CSSProperties =
    variant === "primary"
      ? { background: "var(--accent)", color: "#0b1020", borderColor: "var(--accent)" }
      : variant === "danger"
        ? { background: "var(--bg)", color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)" }
        : { background: "var(--bg)", color: "var(--text)", borderColor: "var(--border)" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`clock-key flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3.5 text-xs font-semibold ${wide ? "col-span-3" : ""}`}
      style={palette}
    >
      <span aria-hidden>{icon}</span>
      <span className="leading-none whitespace-nowrap">{label}</span>
    </button>
  );
}

/**
 * Renders the current table layout (the on-screen PokerTable SVGs) into a single
 * shareable PNG and shows it in a dialog with a "Copy image" button — handy for
 * dropping the seating into a group chat. Each PokerTable SVG is self-contained
 * (literal colours + inline gradient defs), so it rasterises cleanly onto a
 * canvas without any external capture library.
 */
function ShareTablesButton({
  targetRef, title, subtitle,
}: {
  targetRef: React.RefObject<HTMLDivElement>;
  title: string;
  subtitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  async function generate() {
    const container = targetRef.current;
    setBusy(true);
    setErr(null);
    try {
      const svgs = container ? Array.from(container.querySelectorAll("svg")) : [];
      if (!svgs.length) throw new Error("There are no tables to capture yet.");

      // Use the app's own font stack (Geist Sans) for every label, and wait for
      // it to load so the canvas renders with it rather than a fallback.
      const family = getComputedStyle(container ?? document.body).fontFamily
        || "ui-sans-serif, system-ui, sans-serif";
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* proceed with fallback */ }
      }

      const cols = svgs.length > 1 ? 2 : 1;
      const rows = Math.ceil(svgs.length / cols);
      const cellW = 460;
      const cellH = Math.round((cellW * 66) / 100); // matches the SVG viewBox ratio
      const gap = 20, padX = 28, padTop = subtitle ? 70 : 52, padBot = 24;
      const W = padX * 2 + cols * cellW + (cols - 1) * gap;
      const H = padTop + padBot + rows * cellH + (rows - 1) * gap;

      // Export at up to 4× for a crisp image, but clamp so we never exceed the
      // per-dimension / total-area canvas limits browsers enforce (iOS Safari is
      // the tightest, ~4096px and ~16.7 MP), which would otherwise yield a blank
      // image on large multi-table layouts.
      const MAX_DIM = 4096, MAX_AREA = 16_000_000;
      const dpr = Math.max(1, Math.min(4, MAX_DIM / W, MAX_DIM / H, Math.sqrt(MAX_AREA / (W * H))));

      const canvas = document.createElement("canvas");
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not supported here.");
      ctx.scale(dpr, dpr);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#141b3a");
      bg.addColorStop(1, "#0a1024");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#eef3ff";
      ctx.font = `700 26px ${family}`;
      ctx.fillText(title, W / 2, 30);
      if (subtitle) {
        ctx.fillStyle = "rgba(217,245,228,0.7)";
        ctx.font = `500 15px ${family}`;
        ctx.fillText(subtitle, W / 2, 52);
      }

      // Rasterise only the table shapes (an isolated SVG image can't use the
      // page's web font), then redraw each table's text with canvas + Geist.
      const shapeImgs = await Promise.all(svgs.map(s => rasterizeShapes(s as SVGSVGElement, cellW * dpr, cellH * dpr)));
      svgs.forEach((svg, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        // Centre a lone table on the final row of a two-column grid.
        const alone = cols > 1 && i === svgs.length - 1 && svgs.length % cols === 1;
        const x = padX + c * (cellW + gap) + (alone ? (cellW + gap) / 2 : 0);
        const y = padTop + r * (cellH + gap);
        ctx.drawImage(shapeImgs[i], x, y, cellW, cellH);
        drawSvgText(ctx, svg as SVGSVGElement, x, y, cellW, family);
      });

      const out: Blob = await new Promise((res, rej) =>
        canvas.toBlob(b => (b ? res(b) : rej(new Error("Couldn't render the image."))), "image/png"),
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(out);
      urlRef.current = url;
      setBlob(out);
      setImgUrl(url);
      setCopyState("idle");
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't create the image.");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
    }
  }

  const downloadName = `${title.replace(/[^\w-]+/g, "_").slice(0, 40) || "tables"}.png`;

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary !px-2.5 !py-2 shrink-0"
        onClick={generate}
        disabled={busy}
        title="Share a picture of the table layout"
        aria-label="Share table layout"
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      </button>

      {open && (
        <Modal title="Share table layout" onClose={() => setOpen(false)} wide>
          {err ? (
            <p className="neg text-sm">{err}</p>
          ) : (
            <div className="space-y-3">
              {imgUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl} alt="Table layout" className="w-full rounded-lg border" style={{ borderColor: "var(--border)" }} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={copy}>{copyState === "copied" ? "Copied!" : "Copy image"}</button>
                <a className="btn btn-secondary" href={imgUrl ?? undefined} download={downloadName}>Download</a>
                {copyState === "error" && (
                  <span className="text-xs muted">Copying images isn’t supported in this browser — use Download instead.</span>
                )}
                <button className="btn btn-secondary ml-auto" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** Rasterise a table SVG's shapes (text stripped) into a loaded <img>. Text is
 *  drawn separately on the canvas so it uses the app font, not a raster fallback. */
function rasterizeShapes(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("text").forEach(t => t.remove());
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const str = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to rasterise a table.")); };
    img.src = url;
  });
}

/**
 * Redraw every <text> from a table SVG onto the canvas using `family` (the app's
 * Geist stack), reproducing the SVG's position, size, weight, colour, anchor and
 * two-line <tspan> names. Coordinates map from the SVG viewBox to the cell drawn
 * at (x0,y0) with width `cellW` (aspect is preserved, so a single scale works).
 */
function drawSvgText(
  ctx: CanvasRenderingContext2D, svg: SVGSVGElement, x0: number, y0: number, cellW: number, family: string,
) {
  const vbW = svg.viewBox?.baseVal?.width || 100;
  const s = cellW / vbW;
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    const tx = parseFloat(t.getAttribute("x") ?? "0");
    const ty = parseFloat(t.getAttribute("y") ?? "0");
    const fs = parseFloat(t.getAttribute("font-size") ?? "10");
    const weight = t.getAttribute("font-weight") ?? "400";
    const anchor = t.getAttribute("text-anchor") ?? "start";
    const baseline = t.getAttribute("dominant-baseline");
    const ls = parseFloat(t.getAttribute("letter-spacing") ?? "0");
    ctx.save();
    ctx.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
    ctx.textBaseline = baseline === "middle" ? "middle" : "alphabetic";
    ctx.font = `${weight} ${fs * s}px ${family}`;
    ctx.fillStyle = t.getAttribute("fill") ?? "#000";
    const fo = t.getAttribute("fill-opacity");
    if (fo != null) ctx.globalAlpha = parseFloat(fo);
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls * s}px`; } catch { /* not supported */ }
    const tspans = Array.from(t.querySelectorAll("tspan"));
    if (tspans.length) {
      let cy = ty;
      for (const sp of tspans) {
        cy += parseFloat(sp.getAttribute("dy") ?? "0");
        const spx = sp.getAttribute("x");
        const sx = spx != null ? parseFloat(spx) : tx;
        ctx.fillText(sp.textContent ?? "", x0 + sx * s, y0 + cy * s);
      }
    } else {
      ctx.fillText(t.textContent ?? "", x0 + tx * s, y0 + ty * s);
    }
    ctx.restore();
  }
}

function CopyViewerLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const href = `/clock/${token}`;
  async function copy() {
    try {
      const url = typeof window !== "undefined" ? `${window.location.origin}${href}` : href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still openable via the anchor below */
    }
  }
  const iconBtn = "btn btn-secondary !px-2.5 !py-2 shrink-0";
  return (
    <div className="flex items-center gap-1.5">
      <a
        className={iconBtn}
        href={href}
        target="_blank"
        rel="noreferrer"
        title="Open the viewer clock in a new tab"
        aria-label="Open viewer clock"
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      </a>
      <button
        type="button"
        className={iconBtn}
        onClick={copy}
        title={copied ? "Copied!" : "Copy the viewer link"}
        aria-label="Copy viewer link"
      >
        {copied ? (
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div className={`relative w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto`} style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Edit the blind/break ladder of a live tournament. Seeded from the current
 * structure (or the default when none exists yet); the shared
 * {@link useTournamentStructure} hook + {@link StructureEditor} provide template
 * presets and per-row editing/validation. Saving is blocked while invalid.
 */
function EditStructureDialog({
  initialStructure, initialStartingStack, busy, onClose, onSave, inline = false,
}: {
  initialStructure: StructureRow[] | null;
  initialStartingStack: number | null;
  busy: boolean;
  onClose?: () => void;
  onSave: (structure: StructureRow[], startingStack: number) => Promise<void>;
  // When true, render the editor inline (no modal chrome / Cancel button) — used
  // by the live manager's Settings tab, which shows it directly in a card.
  inline?: boolean;
}) {
  const ctrl = useTournamentStructure({ structure: initialStructure, startingStack: initialStartingStack });
  // The values the editor opened with, so we can detect unsaved edits and offer
  // a "Reset changes". Re-derives after a save (props update via SWR).
  const initialSnapshot = useMemo(
    () => ({
      structure: initialStructure && initialStructure.length ? initialStructure : defaultStructure(),
      stack: initialStartingStack ?? DEFAULT_STARTING_STACK,
    }),
    [initialStructure, initialStartingStack],
  );
  const dirty =
    JSON.stringify(ctrl.structure) !== JSON.stringify(initialSnapshot.structure) ||
    ctrl.startingStack !== initialSnapshot.stack;
  const body = (
    <>
      <p className="muted text-sm mb-3">
        Changes take effect immediately. The clock keeps its elapsed time — the current level is re-derived
        from the new ladder, so use “Restart level” afterwards if you need to realign it.
      </p>
      <StructureEditor ctrl={ctrl} />
      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={busy || !!ctrl.error || !dirty} onClick={() => onSave(ctrl.structure, ctrl.startingStack)}>
          Save changes
        </button>
        <button className="btn btn-secondary" disabled={busy || !dirty} onClick={() => ctrl.restore(initialSnapshot.structure, initialSnapshot.stack)}>
          Reset changes
        </button>
        {!inline && <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>}
      </div>
    </>
  );
  if (inline) return body;
  return (
    <Modal title="Edit blind structure" onClose={onClose ?? (() => {})} wide>
      {body}
    </Modal>
  );
}

// Shared column widths so the "Still in" and "Busted" tables line up exactly
// (they're separate <table>s, so without fixed widths each sizes its own
// columns). Used with `table-fixed` + a matching min-width on both tables.
// Frozen left columns (Place + Player) keep player names in view while the
// stats scroll horizontally on narrow screens. `left` for the Player column
// must equal the Place column's width.
const PLACE_W = "2.75rem";
const STICKY_BG = { background: "var(--card)" } as const;
const stickyPlace = "sticky left-0 z-[2]";
const stickyPlayer = "sticky z-[2]";
const stickyPlayerStyle = { left: PLACE_W, background: "var(--card)", borderRight: "1px solid var(--border)" } as const;

function PlayerCols({ isPko }: { isPko: boolean }) {
  return (
    <colgroup>
      <col style={{ width: PLACE_W }} />{/* Place */}
      <col style={{ width: "11rem" }} />{/* Player */}
      <col style={{ width: "3.25rem" }} />{/* Buy-ins */}
      <col style={{ width: "4.5rem" }} />{/* In placement / Payout */}
      {isPko && (
        <>
          <col style={{ width: "4.25rem" }} />{/* Bounties */}
          <col style={{ width: "4.75rem" }} />{/* Total won */}
          <col style={{ width: "4.25rem" }} />{/* Head */}
          <col style={{ width: "3.5rem" }} />{/* Pre KO */}
          <col style={{ width: "4rem" }} />{/* Bounty KO */}
        </>
      )}
    </colgroup>
  );
}

/** Shared header row for the Still-in / Busted standings tables. Headers may
 * wrap to two lines so full labels stay readable in the tight stat columns. */
function StandingsHead({ isPko }: { isPko: boolean }) {
  const wrap = "whitespace-normal leading-tight align-bottom";
  return (
    <thead>
      <tr>
        <th className={`text-center ${wrap} ${stickyPlace}`} style={STICKY_BG}>Place</th>
        <th className={`${wrap} ${stickyPlayer}`} style={stickyPlayerStyle}>Player</th>
        <th className={`text-center ${wrap}`}># Buy-ins</th>
        <th className={`text-right ${wrap}`}>{isPko ? "€ in placement" : "Payout"}</th>
        {isPko && (
          <>
            <th className={`text-right ${wrap}`} title="Cash bounties banked (bounty phase only)">€ in bounties</th>
            <th className={`text-right ${wrap}`} title="Placement payout + bounties banked">€ Total</th>
            <th className={`text-right ${wrap}`} title="Bounty on this player's head">€ Head</th>
            <th className={`text-center ${wrap}`} title="Knockouts made in the pre-bounty phase"># Pre KOs</th>
            <th className={`text-center ${wrap}`} title="Knockouts made in the bounty phase"># Bounty KOs</th>
          </>
        )}
      </tr>
    </thead>
  );
}

function BustDialog({
  alive, rebuysActive, busy, isPko, bountyPhase, roundTo, headFor, onClose, onBust, onRebuy,
}: {
  alive: { player_id: string; name: string; table_no: number | null }[];
  rebuysActive: boolean;
  busy: boolean;
  isPko: boolean;
  bountyPhase: "pre" | "bounty";
  /** Smallest bounty token (EUR) — splits round to whole tokens. */
  roundTo: number;
  /** Current bounty (EUR) on a player's head, for previewing the split. */
  headFor: (pid: string) => number;
  onClose: () => void;
  onBust: (pid: string, eliminatorIds: string[]) => Promise<void>;
  onRebuy: (pid: string, eliminatorIds: string[]) => Promise<void>;
}) {
  const [pid, setPid] = useState<string>("");
  // Winners in odd-chip priority order (index 0 = closest to left of button).
  const [winners, setWinners] = useState<string[]>([]);
  const nameOf = (id: string) => alive.find(p => p.player_id === id)?.name ?? "?";

  const toggleWinner = (id: string) =>
    setWinners(w => (w.includes(id) ? w.filter(x => x !== id) : [...w, id]));
  const move = (i: number, dir: -1 | 1) =>
    setWinners(w => {
      const j = i + dir;
      if (j < 0 || j >= w.length) return w;
      const next = w.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // The eliminator must be at the busted player's table, so only offer bounty
  // winners seated at the same table (falls back to everyone when no seats are
  // assigned, i.e. table_no is null for all).
  const bustedTable = pid ? (alive.find(p => p.player_id === pid)?.table_no ?? null) : null;
  const winnerCandidates = alive.filter(p => p.player_id !== pid && p.table_no === bustedTable);
  // Keep only selected winners that are still valid candidates (drops the bustee
  // and anyone no longer at the busted player's table).
  const candidateIds = new Set(winnerCandidates.map(p => p.player_id));
  const cleanWinners = winners.filter(id => candidateIds.has(id));
  const head = pid ? headFor(pid) : 0;
  const shares = splitBountyChips(head, cleanWinners.length || 1, roundTo);
  // An "odd chip" exists when more than one winner can't split the head evenly.
  const hasOddChip = cleanWinners.length > 1 && shares.some(s => s !== shares[0]);

  const needsEliminator = isPko;
  const ready = !!pid && (!needsEliminator || cleanWinners.length > 0);

  const doBust = () => onBust(pid, needsEliminator ? cleanWinners : []);
  const doRebuy = () => onRebuy(pid, needsEliminator ? cleanWinners : []);

  return (
    <Modal title="Add bustout" onClose={onClose}>
      <label className="label">Who busted?</label>
      <select className="input" value={pid} onChange={e => setPid(e.target.value)}>
        <option value="">Select player…</option>
        {alive.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
      </select>

      {isPko && pid && (
        <>
          <label className="label mt-3">Bounty winner(s)</label>
          <p className="muted text-xs mb-1">
            Pick everyone who shares the bounty — select more than one when a chopped pot is split.
            Only players at the busted player&apos;s table are shown.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {winnerCandidates.map(p => {
              const on = cleanWinners.includes(p.player_id);
              return (
                <button
                  key={p.player_id}
                  type="button"
                  onClick={() => toggleWinner(p.player_id)}
                  className={`text-xs px-2 py-1 rounded border ${on
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-[var(--border)] muted"}`}
                >
                  {p.name}
                </button>
              );
            })}
            {winnerCandidates.length === 0 && (
              <span className="muted text-xs">No other players at this table.</span>
            )}
          </div>

          {pid && cleanWinners.length > 0 && (
            <div className="mt-3 rounded border border-[var(--border)] p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="muted">Bounty to split</span>
                <span className="font-semibold">{eur(head)}</span>
              </div>
              {hasOddChip ? (
                <>
                  <p className="muted mt-2">
                    {eur(head)} doesn&apos;t divide evenly into {eur(roundTo)} chips between
                    {" "}{cleanWinners.length} winners. Order them so the players who get the extra
                    {" "}{eur(roundTo)} chip are at the top (closest to the left of the button).
                  </p>
                  <ul className="mt-2 space-y-1">
                    {cleanWinners.map((id, i) => (
                      <li key={id} className="flex items-center gap-2">
                        <span className="inline-flex gap-0.5">
                          <button type="button" className="px-1 rounded border border-[var(--border)] disabled:opacity-30"
                            disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                          <button type="button" className="px-1 rounded border border-[var(--border)] disabled:opacity-30"
                            disabled={i === cleanWinners.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                        </span>
                        <span className="flex-1">{nameOf(id)}</span>
                        <span className="font-semibold">{eur(shares[i])}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : cleanWinners.length > 1 ? (
                <p className="muted mt-2">Split evenly: {eur(shares[0])} each.</p>
              ) : null}
            </div>
          )}

          <p className="muted text-xs mt-2">
            {bountyPhase === "bounty"
              ? "Bounty phase: half of each winner's share pays out as cash, the rest compounds onto their head."
              : "Pre-bounty phase: each winner's share transfers to their head (no cash yet)."}
          </p>
        </>
      )}

      {rebuysActive ? (
        <>
          <p className="muted text-sm mt-3">Rebuys are open — did they rebuy or are they out?</p>
          <div className="flex gap-2 flex-wrap mt-2">
            <button className="btn" disabled={!ready || busy} onClick={doRebuy}>Rebought (stays in)</button>
            <button className="btn btn-danger" disabled={!ready || busy} onClick={doBust}>Busted out</button>
            <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="flex gap-2 flex-wrap mt-4">
          <button className="btn btn-danger" disabled={!ready || busy} onClick={doBust}>Record bustout</button>
          <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      )}
    </Modal>
  );
}

function AddPlayerDialog({
  addable, seatInfo, busy, onClose, onAddExisting, onCreateAndAdd,
}: {
  addable: Player[];
  // Open-seat info when seating exists; null when the tournament is seatless.
  seatInfo: { open: number } | null;
  busy: boolean;
  onClose: () => void;
  onAddExisting: (playerId: string) => Promise<void>;
  onCreateAndAdd: (name: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  return (
    <Modal title="Add new player" onClose={onClose}>
      <p className="muted text-sm mb-3">
        {seatInfo
          ? `They'll be dropped into a random open seat (${seatInfo.open} free) with a single buy-in.`
          : "They'll join with a single buy-in. Draw seats whenever you like to seat them."}
      </p>
      <label className="label">Add existing player</label>
      <PlayerCombobox
        players={addable}
        onSelect={id => { void onAddExisting(id); }}
        placeholder={addable.length === 0 ? "Everyone is already in" : "Search players…"}
        disabled={busy || addable.length === 0}
      />
      <label className="label mt-3">Or create new</label>
      <div className="flex gap-2 items-center">
        <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="New player name" />
        <button className="btn whitespace-nowrap shrink-0" disabled={busy || !newName.trim()} onClick={() => onCreateAndAdd(newName)}>+ Add</button>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function DrawDialog({
  title, players, busy, onClose, onConfirm,
}: {
  title: string;
  players: { player_id: string; name: string; bucket?: number | null }[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (r: DrawResult) => Promise<void>;
}) {
  const [result, setResult] = useState<DrawResult | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      {/* No auto-draw: the director first sets the number of tables / seats per
          table, then clicks "Draw seats" inside the panel to generate a seating. */}
      <SeatDrawPanel players={players} onResult={setResult} />
      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={!result || busy} onClick={() => result && onConfirm(result)}>Confirm seating</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function MoveDialog({
  suggestion, tableViews, seatsPerTable, busy, onClose, onConfirm,
}: {
  suggestion: Extract<RebalanceSuggestion, { kind: "move" }>;
  tableViews: { table_no: number; occupants: TableOccupant[] }[];
  seatsPerTable: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (moverId: string, toTable: number, toSeat: number | null) => Promise<void>;
}) {
  const { fromTable, toTable } = suggestion;
  const bySeat = (a: TableOccupant, b: TableOccupant) => a.seat_no - b.seat_no;
  const fromOcc = [...(tableViews.find(tv => tv.table_no === fromTable)?.occupants ?? [])].sort(bySeat);
  const toOcc = [...(tableViews.find(tv => tv.table_no === toTable)?.occupants ?? [])].sort(bySeat);
  const freeTo = freeSeats(toOcc.map(o => o.seat_no), seatsPerTable);

  // Default: big-blind-aware placement. Manual: the director picks the exact
  // player to move and the exact open seat they take.
  const [manual, setManual] = useState(false);

  // Auto inputs — the director tells us who posts the next big blind on each
  // table; the source BB relocates and is seated so they take the big blind
  // soonest on the target table.
  const [fromBbSeat, setFromBbSeat] = useState<number>(fromOcc[0]?.seat_no ?? 1);
  const [toBbSeat, setToBbSeat] = useState<number>(toOcc[0]?.seat_no ?? 1);

  // Manual inputs.
  const [manualMoverSeat, setManualMoverSeat] = useState<number>(fromOcc[0]?.seat_no ?? 1);
  const [manualToSeat, setManualToSeat] = useState<number>(freeTo[0] ?? 0);

  const autoMover = fromOcc.find(o => o.seat_no === fromBbSeat) ?? null;
  const autoToSeat = incomingBigBlindSeat(toOcc.map(o => o.seat_no), seatsPerTable, toBbSeat);
  const manualMover = fromOcc.find(o => o.seat_no === manualMoverSeat) ?? null;
  const manualToSeatVal = freeTo.includes(manualToSeat) ? manualToSeat : null;

  const mover = manual ? manualMover : autoMover;
  const toSeat = manual ? manualToSeatVal : autoToSeat;

  return (
    <Modal title={`Move a player to table ${toTable}`} onClose={onClose}>
      <p className="muted text-sm mb-3">
        Moving one player from table {fromTable} to table {toTable}.
      </p>

      <div className="mb-3">
        <Toggle checked={manual} onChange={setManual} label="Choose the player & seat manually" size="sm" labelPosition="right" className="text-sm" />
      </div>

      {manual ? (
        <>
          <label className="label">Player to move (table {fromTable})</label>
          <select className="input" value={manualMoverSeat} onChange={e => setManualMoverSeat(Number(e.target.value))}>
            {fromOcc.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
          </select>

          <label className="label mt-3">Target seat (table {toTable})</label>
          {freeTo.length ? (
            <select className="input" value={manualToSeat} onChange={e => setManualToSeat(Number(e.target.value))}>
              {freeTo.map(s => <option key={s} value={s}>Seat {s}</option>)}
            </select>
          ) : (
            <p className="text-sm neg">Table {toTable} has no open seat.</p>
          )}
        </>
      ) : (
        <>
          <p className="muted text-xs mb-2">
            Tell me who posts the next big blind on each table; the mover is seated to take the big blind as soon as possible.
          </p>
          <label className="label">Next big blind on table {fromTable} (moves)</label>
          <select className="input" value={fromBbSeat} onChange={e => setFromBbSeat(Number(e.target.value))}>
            {fromOcc.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
          </select>

          <label className="label mt-3">Next big blind on table {toTable}</label>
          <select className="input" value={toBbSeat} onChange={e => setToBbSeat(Number(e.target.value))}>
            {toOcc.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
          </select>
        </>
      )}

      {mover && toSeat != null ? (
        <p className="text-sm mt-3"><span className="font-semibold">{mover.name}</span> will move to table {toTable}, seat {toSeat}.</p>
      ) : toSeat == null ? (
        <p className="text-sm mt-3 neg">Table {toTable} has no open seat.</p>
      ) : null}

      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={!mover || toSeat == null || busy} onClick={() => mover && toSeat != null && onConfirm(mover.player_id, toTable, toSeat)}>Confirm move</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
