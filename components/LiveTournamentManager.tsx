"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Player, Seating } from "@/lib/types";
import { apiKeys, postLiveAction, ApiError, createPlayer, invalidateAfterTournamentDelete } from "@/lib/api";
import TournamentClock from "@/components/TournamentClock";
import StructureEditor from "@/components/StructureEditor";
import { useTournamentStructure } from "@/components/useTournamentStructure";
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
  rebalanceSuggestion, shuffle, planBreak, incomingBigBlindSeat,
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("viewer");

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
        <h2 className="text-lg font-semibold">Tournament clock</h2>
        {hasStructure ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {!clockStarted ? (
                <button className="btn" disabled={busy} onClick={() => clockAct({ type: "start" }, "start_clock", {})}>
                  Start clock
                </button>
              ) : (
                <>
                  {clockRunning ? (
                    <button className="btn" disabled={busy} onClick={() => clockAct({ type: "setRunning", running: false }, "set_clock_running", { running: false })}>
                      Pause
                    </button>
                  ) : (
                    <button className="btn" disabled={busy} onClick={() => clockAct({ type: "setRunning", running: true }, "set_clock_running", { running: true })}>
                      Resume
                    </button>
                  )}
                  <button className="btn btn-secondary" disabled={busy} title="Rewind 1 minute" onClick={() => clockAct({ type: "adjust", deltaMs: -60_000 }, "adjust_clock", { delta_ms: -60_000 })}>
                    -1:00
                  </button>
                  <button className="btn btn-secondary" disabled={busy} title="Fast-forward 1 minute" onClick={() => clockAct({ type: "adjust", deltaMs: 60_000 }, "adjust_clock", { delta_ms: 60_000 })}>
                    +1:00
                  </button>
                  <button className="btn btn-secondary" disabled={busy} title="Jump to the start of the previous level and pause" onClick={() => seekLevel("prev")}>
                    Previous Level
                  </button>
                  <button className="btn btn-secondary" disabled={busy} title="Jump back to the start of the current level and pause" onClick={() => seekLevel("start")}>
                    Restart level
                  </button>
                  <button className="btn btn-secondary" disabled={busy} title="Jump to the start of the next level and pause" onClick={() => seekLevel("next")}>
                    Next Level
                  </button>
                  <button className="btn btn-secondary" disabled={busy} title="Restart the clock from level 1" onClick={() => setRestartOpen(true)}>
                    Restart
                  </button>
                </>
              )}
            </div>
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
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <button className="btn" disabled={busy || alive.length === 0} onClick={() => setBustOpen(true)}>Add bustout</button>
          <button
            className="btn btn-secondary"
            disabled={busy || (busted.length === 0 && clockAggregates.reEntries === 0)}
            title="Undo the most recent bustout — puts the player back in their seat, reverts any rebalancing done since, and (in PKO) gives back the bounty cash and heads. Click again to keep undoing earlier bustouts one at a time."
            onClick={() => act("undo_latest_bust", {})}
          >
            Undo latest bustout
          </button>
          {rebuysActive && (
            <button
              className="btn btn-secondary"
              disabled={busy || !canAddPlayer}
              title={hasSeats && freeSlots.length === 0 ? "No open seats — can't add a player" : "Add a late-arriving player"}
              onClick={() => setAddOpen(true)}
            >
              Add new player
            </button>
          )}
          <button
            className="btn btn-secondary"
            disabled={busy || winnerDetermined}
            title={winnerDetermined ? "The winner is decided — deals are closed" : "Override the payout per finishing position"}
            onClick={() => setDealOpen(true)}
          >
            {hasDeal ? "Edit deal" : "Make a deal"}
          </button>
          {hasDeal && <span className="text-xs font-semibold" style={{ color: "rgb(251 191 36)" }}>Deal applied</span>}
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Seating</h2>
          {hasSeats ? (
            canRedraw
              ? <button className="btn btn-secondary text-sm" disabled={busy} onClick={() => setRedrawWarn(true)}>Re-draw seats</button>
              : <span className="text-xs muted">Locked — play has started</span>
          ) : (
            <button className="btn text-sm" disabled={busy || alive.length < 2} onClick={() => setDrawOpen(true)}>Draw seats</button>
          )}
        </div>
        {hasSeats ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      <div className="card">
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
              <div className="overflow-x-auto">
                <table className="table table-fixed whitespace-nowrap" style={{ minWidth: isPko ? "55rem" : "24rem" }}>
                  <PlayerCols isPko={isPko} />
                  <thead>
                    <tr>
                      <th className="text-center">Place</th>
                      <th>Player</th>
                      <th className="text-center">Buy-ins</th>
                      <th className="text-right">{isPko ? "In placement" : "Payout"}</th>
                      {isPko && (
                        <>
                          <th className="text-right" title="Cash bounties banked (bounty phase only)">Bounties</th>
                          <th className="text-right" title="Placement payout + bounties banked">Total won</th>
                          <th className="text-right" title="Bounty currently on this player's head">Head</th>
                          <th className="text-center" title="Knockouts made in the pre-bounty phase">Pre KO</th>
                          <th className="text-center" title="Knockouts made in the bounty phase">Bounty KO</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {alive.map(e => {
                      const b = isPko ? bountyState?.byPlayer.get(e.player_id) : null;
                      return (
                        <tr key={e.player_id}>
                          <td className="text-center muted">—</td>
                          <td>
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
              <div className="overflow-x-auto">
                <table className="table table-fixed whitespace-nowrap" style={{ minWidth: isPko ? "55rem" : "24rem" }}>
                  <PlayerCols isPko={isPko} />
                  <thead>
                    <tr>
                      <th className="text-center">Place</th>
                      <th>Player</th>
                      <th className="text-center">Buy-ins</th>
                      <th className="text-right">{isPko ? "In placement" : "Payout"}</th>
                      {isPko && (
                        <>
                          <th className="text-right" title="Cash bounties banked (bounty phase only)">Bounties</th>
                          <th className="text-right" title="Placement payout + bounties banked">Total won</th>
                          <th className="text-right" title="Bounty left on this player's head">Head</th>
                          <th className="text-center" title="Knockouts made in the pre-bounty phase">Pre KO</th>
                          <th className="text-center" title="Knockouts made in the bounty phase">Bounty KO</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {busted.map(e => {
                      const b = isPko ? bountyState?.byPlayer.get(e.player_id) : null;
                      return (
                        <tr key={e.player_id}>
                          <td className="text-center">{ordinal(e.finish_position!)}</td>
                          <td>{nameById.get(e.player_id) ?? "?"}</td>
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
            <h2 className="text-lg font-semibold">Viewer link &amp; display</h2>
            {t.share_token ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CopyViewerLink token={t.share_token} />
                </div>
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

          {settingsTab === "tournament" && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold">Edit tournament</h2>
            <EditTournamentDialog
              inline
              tournament={t}
              roster={alive.concat(busted).map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?" }))}
              playStarted={playStarted}
              busy={busy}
              onSave={saveTournamentInfo}
              onRequestRestart={() => setRestartAllOpen(true)}
            />
          </div>
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
        message="This resets the clock back to Level 1 at 0:00 and starts it running. The elapsed time is lost and this can't be undone."
        confirmLabel="Restart clock"
        cancelLabel="Keep current"
        destructive
        busy={busy}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => { setRestartOpen(false); void clockAct({ type: "start" }, "start_clock", {}); }}
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
type SettingsTab = "viewer" | "tournament" | "structure" | "danger";

function SettingsTabBar({ tab, setTab }: {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
}) {
  const tabs: [SettingsTab, string][] = [
    ["viewer", "Viewer & display"],
    ["tournament", "Tournament"],
    ["structure", "Structure"],
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
  return (
    <div className="ml-auto flex items-center gap-2">
      <a className="link text-sm" href={href} target="_blank" rel="noreferrer">Open viewer</a>
      <button className="btn btn-secondary text-sm" onClick={copy}>
        {copied ? "Copied!" : "Copy link"}
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
  const body = (
    <>
      <p className="muted text-sm mb-3">
        Changes take effect immediately. The clock keeps its elapsed time — the current level is re-derived
        from the new ladder, so use “Restart level” afterwards if you need to realign it.
      </p>
      <StructureEditor ctrl={ctrl} />
      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={busy || !!ctrl.error} onClick={() => onSave(ctrl.structure, ctrl.startingStack)}>
          Save structure
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
function PlayerCols({ isPko }: { isPko: boolean }) {
  return (
    <colgroup>
      <col style={{ width: "4rem" }} />{/* Place */}
      <col />{/* Player — takes the remaining width */}
      <col style={{ width: "5rem" }} />{/* Buy-ins */}
      <col style={{ width: "7rem" }} />{/* In placement / Payout */}
      {isPko && (
        <>
          <col style={{ width: "6rem" }} />{/* Bounties */}
          <col style={{ width: "7rem" }} />{/* Total won */}
          <col style={{ width: "6rem" }} />{/* Head */}
          <col style={{ width: "5rem" }} />{/* Pre KO */}
          <col style={{ width: "6rem" }} />{/* Bounty KO */}
        </>
      )}
    </colgroup>
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
  const bySeat = (a: TableOccupant, b: TableOccupant) => a.seat_no - b.seat_no;
  const fromOcc = [...(tableViews.find(tv => tv.table_no === suggestion.fromTable)?.occupants ?? [])].sort(bySeat);
  const toOcc = [...(tableViews.find(tv => tv.table_no === suggestion.toTable)?.occupants ?? [])].sort(bySeat);

  // The director tells us who posts the next big blind on each table: the source
  // BB is the player who relocates; the target BB lets us find the open seat that
  // posts the big blind soonest (an open seat between the SB and BB makes the
  // mover the next BB).
  const [fromBbSeat, setFromBbSeat] = useState<number>(fromOcc[0]?.seat_no ?? 1);
  const [toBbSeat, setToBbSeat] = useState<number>(toOcc[0]?.seat_no ?? 1);

  const mover = fromOcc.find(o => o.seat_no === fromBbSeat) ?? null;
  const toSeat = incomingBigBlindSeat(toOcc.map(o => o.seat_no), seatsPerTable, toBbSeat);

  return (
    <Modal title={`Move a player to table ${suggestion.toTable}`} onClose={onClose}>
      <p className="muted text-sm mb-3">
        Moving one player from table {suggestion.fromTable} to table {suggestion.toTable}. Tell me who posts the next big blind on each table: the next big blind on table {suggestion.fromTable} relocates and is seated so they take the big blind as soon as possible on table {suggestion.toTable}.
      </p>

      <label className="label">Next big blind on table {suggestion.fromTable} (moves)</label>
      <select className="input" value={fromBbSeat} onChange={e => setFromBbSeat(Number(e.target.value))}>
        {fromOcc.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
      </select>

      <label className="label mt-3">Next big blind on table {suggestion.toTable}</label>
      <select className="input" value={toBbSeat} onChange={e => setToBbSeat(Number(e.target.value))}>
        {toOcc.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
      </select>

      {mover && toSeat != null ? (
        <p className="text-sm mt-3"><span className="font-semibold">{mover.name}</span> will move to table {suggestion.toTable}, seat {toSeat}.</p>
      ) : toSeat == null ? (
        <p className="text-sm mt-3 neg">Table {suggestion.toTable} has no open seat.</p>
      ) : null}

      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={!mover || toSeat == null || busy} onClick={() => mover && onConfirm(mover.player_id, suggestion.toTable, toSeat)}>Confirm move</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
