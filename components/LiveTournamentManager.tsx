"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Player, Seating, PayoutSlot } from "@/lib/types";
import { apiKeys, postLiveAction, ApiError, invalidateAfterPlayerMutation, invalidateAfterTournamentDelete } from "@/lib/api";
import {
  rebalanceSuggestion, buttonFromBigBlind, shuffle, planBreak, randomFreeSeat, freeSeats,
  type Layout, type RebalanceSuggestion, type SeatAssignment, type TableSeats,
} from "@/lib/seating";
import { Toggle } from "@/components/ui/Toggle";
import NumberInput from "@/components/NumberInput";
import ConfirmDialog from "@/components/ConfirmDialog";
import PokerTable, { type TableOccupant } from "@/components/PokerTable";
import PlayerCombobox from "@/components/PlayerCombobox";
import SeatDrawPanel, { type DrawResult } from "@/components/SeatDrawPanel";

type LiveEntry = {
  player_id: string;
  buy_ins: number;
  finish_position: number | null;
  table_no: number | null;
  seat_no: number | null;
  bucket: number | null;
  // Computed euro payout for this entry (includes any deal/override).
  payout: number;
};

type LiveDetail = {
  tournament: {
    id: string;
    name: string;
    state: "Active" | "Finished";
    buy_in_amount: number;
    payout_structure: PayoutSlot[];
    payout_overrides?: Record<string, number> | null;
    seating: Seating | null;
    rebuys_allowed: boolean;
    rebuy_window_open: boolean;
    version: number;
    display_name?: string;
  };
  entries: LiveEntry[];
};

type PodiumRow = {
  position: number;
  pct: number;
  amount: number;          // current payout (deal override if set, else % of pool)
  originalAmount: number;  // pool × pct (what the % structure pays)
  player_id: string | null;
  name: string;
};

/**
 * Live tournament manager (issue #20). The dense entry form is replaced by a
 * compact director console: rebuy-window toggle, seat draw / re-draw, "Add
 * bust-out", MTT rebalancing suggestions, and Finish. Every mutation is a
 * version-checked RPC routed through {@link postLiveAction}; SWR refetches the
 * detail after each so the next call carries a fresh version.
 */
export default function LiveTournamentManager({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading } = useSWR<LiveDetail>(apiKeys.tournament(id));
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const nameById = useMemo(() => new Map((playersData ?? []).map(p => [p.id, p.name])), [playersData]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bustOpen, setBustOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [redrawWarn, setRedrawWarn] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  // Edge-triggered rebalance dismissal keyed by the alive count that triggered.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState<RebalanceSuggestion | null>(null);
  const [dealOpen, setDealOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading || !data) return <div className="muted">Loading…</div>;
  const t = data.tournament;
  const version = t.version;
  const entries = data.entries;

  const alive = entries.filter(e => e.finish_position == null);
  const busted = entries.filter(e => e.finish_position != null).sort((a, b) => (a.finish_position ?? 0) - (b.finish_position ?? 0));
  const seated = alive.filter(e => e.seat_no != null && e.table_no != null);
  const hasSeats = !!t.seating && seated.length > 0;
  const seatsPerTable = t.seating?.seats_per_table ?? 9;
  const rebuysActive = t.rebuys_allowed && t.rebuy_window_open;
  const hasDeal = !!t.payout_overrides && Object.keys(t.payout_overrides).length > 0;
  // A paid position is "locked in" once a finisher holds a position the payout
  // structure pays. While that's true, rebuys auto-close and can't be reopened
  // (the director must undo bust-outs past the bubble first).
  const paidPositions = new Set(t.payout_structure.map(s => s.position));
  const inMoneyDetermined = entries.some(e => e.finish_position != null && paidPositions.has(e.finish_position));
  // Which paid positions would be filled if we finished now. Finishing
  // auto-crowns a lone survivor 1st, so include position 1 when one is left.
  const willDetermine = new Set(entries.filter(e => e.finish_position != null).map(e => e.finish_position!));
  if (alive.length === 1) willDetermine.add(1);
  const undecidedPaidCount = [...paidPositions].filter(p => !willDetermine.has(p)).length;
  const allPaidDetermined = undecidedPaidCount === 0;
  // Once 1st place is decided the result is final — no more deals.
  const winnerDetermined = entries.some(e => e.finish_position === 1);
  // Re-drawing seats shuffles everyone — only safe before the night starts, so
  // it's offered only while nobody has rebought or busted.
  const canRedraw = busted.length === 0 && entries.every(e => e.buy_ins <= 1);

  // Occupied physical seats per table (for picking random open seats on moves).
  const occupiedByTable = new Map<number, number[]>();
  for (const e of seated) {
    const arr = occupiedByTable.get(e.table_no!) ?? [];
    arr.push(e.seat_no!);
    occupiedByTable.set(e.table_no!, arr);
  }

  // Every open physical seat across all tables — used to drop a late entrant
  // into a random empty chair. When no seats are drawn yet there are none, but
  // a late entry can still join unseated.
  const totalTables = t.seating?.tables ?? 0;
  const freeSlots: { table_no: number; seat_no: number }[] = [];
  if (hasSeats) {
    for (let tno = 1; tno <= totalTables; tno++) {
      for (const s of freeSeats(occupiedByTable.get(tno) ?? [], seatsPerTable)) {
        freeSlots.push({ table_no: tno, seat_no: s });
      }
    }
  }
  // Late entries are only possible while rebuys are open. If seats are drawn we
  // also need at least one open chair (the rules say a full house can't grow).
  const canAddPlayer = rebuysActive && (!hasSeats || freeSlots.length > 0);
  const enteredIds = new Set(entries.map(e => e.player_id));
  const addablePlayers = (playersData ?? []).filter(p => !enteredIds.has(p.id));

  // Prize pool = every buy-in (incl. rebuys) at the tournament's buy-in.
  const totalBuyIns = entries.reduce((s, e) => s + e.buy_ins, 0);
  const prizePool = totalBuyIns * t.buy_in_amount;

  // The amount each paid position pays right now: a deal override if set,
  // otherwise pool × pct. Used by both the always-on payouts panel/podium and
  // as the default values in the "make a deal" dialog.
  const playerAtPosition = new Map<number, LiveEntry>();
  for (const e of entries) if (e.finish_position != null) playerAtPosition.set(e.finish_position, e);
  const podium: PodiumRow[] = [...t.payout_structure]
    .sort((a, b) => a.position - b.position)
    .map(slot => {
      const originalAmount = prizePool * (slot.pct / 100);
      const override = t.payout_overrides?.[String(slot.position)];
      const amount = override != null ? override : originalAmount;
      const at = playerAtPosition.get(slot.position) ?? null;
      return {
        position: slot.position,
        pct: slot.pct,
        amount,
        originalAmount,
        player_id: at?.player_id ?? null,
        name: at ? (nameById.get(at.player_id) ?? "?") : "—",
      };
    });

  // Current physical layout (alive, seated players grouped by table in ring
  // order). Cheap to derive each render — kept out of a hook so it can live
  // below the loading guard above without breaking the rules of hooks.
  const layout: Layout = (() => {
    const byTable = new Map<number, LiveEntry[]>();
    for (const e of seated) {
      if (!byTable.has(e.table_no!)) byTable.set(e.table_no!, []);
      byTable.get(e.table_no!)!.push(e);
    }
    return {
      seats_per_table: t.seating?.seats_per_table ?? 9,
      tables: [...byTable.entries()].sort((a, b) => a[0] - b[0]).map(([tno, es]) => ({
        table_no: tno,
        occupants: [...es].sort((a, b) => a.seat_no! - b.seat_no!).map(e => e.player_id),
      })),
    };
  })();

  const suggestion: RebalanceSuggestion = hasSeats ? rebalanceSuggestion(layout) : { kind: "none" };
  const activeSuggestion = suggestion.kind !== "none" ? suggestion : null;
  const showRebalance = !!activeSuggestion && dismissedAt !== alive.length;

  async function act(action: string, payload: Record<string, unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await postLiveAction(id, action, { expected_version: version, ...payload });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- Tables for visualization (occupants at their real physical seats) ----
  const tableViews: { table_no: number; occupants: TableOccupant[] }[] =
    [...occupiedByTable.keys()].sort((a, b) => a - b).map(tno => ({
      table_no: tno,
      occupants: seated
        .filter(e => e.table_no === tno)
        .map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?", seat_no: e.seat_no! })),
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push("/tournaments")}
          title="Everything is saved automatically — this just returns to the tournaments list"
        >
          Save &amp; close
        </button>
        <button
          type="button"
          className={allPaidDetermined ? "btn" : "btn btn-secondary"}
          disabled={busy || !allPaidDetermined}
          title={allPaidDetermined ? "Finish and include in stats" : "All payout positions must be decided before finishing"}
          onClick={() => setFinishOpen(true)}
        >
          Finish tournament
        </button>
      </div>

      {err && <div className="card neg">{err}</div>}

      {/* Prize pool + projected payouts — always visible. Shows the current
          pool and a podium of paid positions (deal amount or pool × pct),
          with the confirmed player's name once they finish in that place. */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <div className="text-sm muted">Prize pool</div>
            <div className="text-2xl font-bold">€{prizePool.toFixed(2)}</div>
          </div>
          <div className="flex gap-2 items-center">
            {hasDeal && <span className="text-xs font-semibold" style={{ color: "rgb(251 191 36)" }}>Deal applied</span>}
            <button
              className="btn btn-secondary text-sm"
              disabled={busy || winnerDetermined}
              title={winnerDetermined ? "The winner is decided — deals are closed" : undefined}
              onClick={() => setDealOpen(true)}
            >
              {hasDeal ? "Edit deal" : "Make a deal"}
            </button>
          </div>
        </div>
        <ul className="space-y-1">
          {podium.map(row => (
            <li
              key={row.position}
              className="flex items-center justify-between gap-3 text-sm rounded px-3 py-2"
              style={{ background: "var(--bg)" }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
                  style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--text)" }}>
                  {row.position}
                </span>
                <span className={row.player_id ? "font-medium truncate" : "muted truncate"}>
                  {row.player_id ? row.name : "Not decided yet"}
                </span>
              </span>
              <span className="font-semibold shrink-0">€{row.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Status + rebuy window + primary actions */}
      <div className="card space-y-3">
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
                <span className="text-xs muted">Locked — undo bust-outs past the money to reopen</span>
              )}
            </div>
          ) : (
            <span className="text-xs muted">Rebuys not allowed</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
          <button className="btn" disabled={busy || alive.length === 0} onClick={() => setBustOpen(true)}>Add bust-out</button>
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
            {tableViews.map(tv => (
              <PokerTable
                key={tv.table_no}
                tableNo={tv.table_no}
                occupants={tv.occupants}
                seats={t.seating?.seats_per_table ?? null}
                buttonSeat={t.seating?.buttons?.[String(tv.table_no)] ?? 1}
              />
            ))}
          </div>
        ) : (
          <p className="muted text-sm">No seats assigned. Bust-outs and rebuys still work — draw seats whenever you like to enable table rebalancing.</p>
        )}
      </div>

      {/* Players / standings */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Players</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold muted mb-2">Still in ({alive.length})</h3>
            <ul className="space-y-1">
              {alive.map(e => (
                <li key={e.player_id} className="flex items-center justify-between text-sm rounded px-2 py-1" style={{ background: "var(--bg)" }}>
                  <span>{nameById.get(e.player_id) ?? "?"}</span>
                  <span className="muted text-xs">
                    {e.table_no != null ? `T${e.table_no} · S${e.seat_no}` : "unseated"}
                    {e.buy_ins > 1 ? ` · ${e.buy_ins} buy-ins` : ""}
                  </span>
                </li>
              ))}
              {alive.length === 0 && <li className="muted text-sm">Nobody left in.</li>}
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h3 className="text-sm font-semibold muted">Busted ({busted.length})</h3>
              {busted.length > 0 && (
                <button
                  className="btn-secondary text-xs px-2 py-0.5 rounded border border-[var(--border)]"
                  disabled={busy}
                  title="Undo the most recent bust-out — reverts any rebalancing done since and puts the player back in their seat"
                  onClick={() => act("undo_latest_bust", {})}
                >
                  Undo latest bustout
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {busted.map(e => (
                <li key={e.player_id} className="flex items-center justify-between gap-2 text-sm rounded px-2 py-1" style={{ background: "var(--bg)" }}>
                  <span className="truncate">{nameById.get(e.player_id) ?? "?"}</span>
                  <span className="muted text-xs shrink-0">
                    {ordinal(e.finish_position!)}
                    {e.payout > 0 ? ` · €${e.payout.toFixed(2)}` : ""}
                    {e.buy_ins > 1 ? ` · ${e.buy_ins} buy-ins` : ""}
                  </span>
                </li>
              ))}
              {busted.length === 0 && <li className="muted text-sm">No bust-outs yet.</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* ---- Dialogs ---- */}
      {bustOpen && (
        <BustDialog
          alive={alive.map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?" }))}
          rebuysActive={rebuysActive}
          busy={busy}
          onClose={() => setBustOpen(false)}
          onBust={async pid => { await act("record_bust", { player_id: pid }); setBustOpen(false); }}
          onRebuy={async pid => { await act("record_buyin", { player_id: pid }); setBustOpen(false); }}
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
          busy={busy}
          onClose={() => setMoveOpen(null)}
          onConfirm={async (moverId, fromButtonSeat, toTable) => {
            // Land the mover in a random open seat on the target table.
            const toSeat = randomFreeSeat(occupiedByTable.get(toTable) ?? [], seatsPerTable, () => Math.random());
            if (toSeat == null) { setErr("That table is full."); return; }
            await act("rebalance_move", { player_id: moverId, to_table: toTable, to_seat: toSeat, from_button_seat: fromButtonSeat });
            setMoveOpen(null);
          }}
        />
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

      {/* Destructive action lives at the very bottom, away from the primary
          controls, so it isn't fired by accident. */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || deleting}
          onClick={() => setDeleteOpen(true)}
          title="Permanently delete this unfinished tournament"
        >
          Delete tournament
        </button>
      </div>

      <ConfirmDialog
        open={finishOpen}
        title="Finish this tournament?"
        message="This marks the tournament Finished and includes it in the stats. Finishing positions become final."
        confirmLabel="Finish"
        cancelLabel="Keep playing"
        busy={busy}
        onCancel={() => setFinishOpen(false)}
        onConfirm={async () => { await act("finish", {}); setFinishOpen(false); router.push("/tournaments"); }}
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
    const r = await fetch("/api/players", { method: "POST", body: JSON.stringify({ name: trimmed }) });
    if (!r.ok) { setErr("Failed to create player"); return; }
    const p: Player = await r.json();
    await invalidateAfterPlayerMutation();
    await onAddPlayer(p.id);
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl shadow-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function BustDialog({
  alive, rebuysActive, busy, onClose, onBust, onRebuy,
}: {
  alive: { player_id: string; name: string }[];
  rebuysActive: boolean;
  busy: boolean;
  onClose: () => void;
  onBust: (pid: string) => Promise<void>;
  onRebuy: (pid: string) => Promise<void>;
}) {
  const [pid, setPid] = useState<string>("");
  return (
    <Modal title="Add bust-out" onClose={onClose}>
      <label className="label">Who busted?</label>
      <select className="input" value={pid} onChange={e => setPid(e.target.value)}>
        <option value="">Select player…</option>
        {alive.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
      </select>

      {rebuysActive ? (
        <>
          <p className="muted text-sm mt-3">Rebuys are open — did they rebuy or are they out?</p>
          <div className="flex gap-2 flex-wrap mt-2">
            <button className="btn" disabled={!pid || busy} onClick={() => onRebuy(pid)}>Rebought (stays in)</button>
            <button className="btn btn-danger" disabled={!pid || busy} onClick={() => onBust(pid)}>Busted out</button>
            <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="flex gap-2 flex-wrap mt-4">
          <button className="btn btn-danger" disabled={!pid || busy} onClick={() => onBust(pid)}>Record bust-out</button>
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
      <SeatDrawPanel players={players} onResult={setResult} autoDraw />
      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={!result || busy} onClick={() => result && onConfirm(result)}>Confirm seating</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function MoveDialog({
  suggestion, tableViews, busy, onClose, onConfirm,
}: {
  suggestion: Extract<RebalanceSuggestion, { kind: "move" }>;
  tableViews: { table_no: number; occupants: TableOccupant[] }[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (moverId: string, fromButtonSeat: number, toTable: number) => Promise<void>;
}) {
  const fromTable = tableViews.find(tv => tv.table_no === suggestion.fromTable);
  const occ = fromTable?.occupants ?? [];
  const [bbSeat, setBbSeat] = useState<number>(occ.length ? occ[occ.length - 1].seat_no : 1);

  // The player in the big blind relocates; the button is pinned two seats back.
  const bbIndex = occ.findIndex(o => o.seat_no === bbSeat);
  const mover = bbIndex >= 0 ? occ[bbIndex] : null;
  const buttonIdx = buttonFromBigBlind(occ.length, bbIndex >= 0 ? bbIndex : 0);
  const fromButtonSeat = occ[buttonIdx]?.seat_no ?? 1;

  return (
    <Modal title={`Move a player to table ${suggestion.toTable}`} onClose={onClose}>
      <p className="muted text-sm mb-3">
        Pick who is in the big blind on table {suggestion.fromTable}. That player moves to table {suggestion.toTable}; the button is pinned so the remaining blinds stay accurate.
      </p>
      <label className="label">Big blind on table {suggestion.fromTable}</label>
      <select className="input" value={bbSeat} onChange={e => setBbSeat(Number(e.target.value))}>
        {occ.map(o => <option key={o.player_id} value={o.seat_no}>Seat {o.seat_no} — {o.name}</option>)}
      </select>
      {mover && (
        <p className="text-sm mt-3"><span className="font-semibold">{mover.name}</span> will move to table {suggestion.toTable}.</p>
      )}
      <div className="flex gap-2 mt-4">
        <button className="btn" disabled={!mover || busy} onClick={() => mover && onConfirm(mover.player_id, fromButtonSeat, suggestion.toTable)}>Confirm move</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
