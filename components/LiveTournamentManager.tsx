"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Player, Seating, PayoutSlot } from "@/lib/types";
import { apiKeys, postLiveAction, ApiError } from "@/lib/api";
import {
  rebalanceSuggestion, applyBreak, buttonFromBigBlind,
  type Layout, type RebalanceSuggestion, type SeatAssignment,
} from "@/lib/seating";
import { Toggle } from "@/components/ui/Toggle";
import NumberInput from "@/components/NumberInput";
import ConfirmDialog from "@/components/ConfirmDialog";
import PokerTable, { type TableOccupant } from "@/components/PokerTable";
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

type PodiumRow = { position: number; amount: number; player_id: string | null; name: string };

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

  if (isLoading || !data) return <div className="muted">Loading…</div>;
  const t = data.tournament;
  const version = t.version;
  const entries = data.entries;

  const alive = entries.filter(e => e.finish_position == null);
  const busted = entries.filter(e => e.finish_position != null).sort((a, b) => (a.finish_position ?? 0) - (b.finish_position ?? 0));
  const seated = alive.filter(e => e.seat_no != null && e.table_no != null);
  const hasSeats = !!t.seating && seated.length > 0;
  const rebuysActive = t.rebuys_allowed && t.rebuy_window_open;
  const hasDeal = !!t.payout_overrides && Object.keys(t.payout_overrides).length > 0;

  // Prize pool = every buy-in (incl. rebuys) at the tournament's buy-in.
  const prizePool = entries.reduce((s, e) => s + e.buy_ins, 0) * t.buy_in_amount;

  // The amount each paid position pays right now: a deal override if set,
  // otherwise pool × pct. Used by both the always-on payouts panel/podium and
  // as the default values in the "make a deal" dialog.
  const playerAtPosition = new Map<number, LiveEntry>();
  for (const e of entries) if (e.finish_position != null) playerAtPosition.set(e.finish_position, e);
  const podium: PodiumRow[] = [...t.payout_structure]
    .sort((a, b) => a.position - b.position)
    .map(slot => {
      const override = t.payout_overrides?.[String(slot.position)];
      const amount = override != null ? override : prizePool * (slot.pct / 100);
      const at = playerAtPosition.get(slot.position) ?? null;
      return {
        position: slot.position,
        amount,
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

  // ---- Tables for visualization (current occupants, ring order) ----
  const tableViews: { table_no: number; occupants: TableOccupant[] }[] = layout.tables.map(tbl => ({
    table_no: tbl.table_no,
    occupants: tbl.occupants.map((pid, i) => ({ player_id: pid, name: nameById.get(pid) ?? "?", seat_no: i + 1 })),
  }));

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="btn btn-secondary text-sm"
        onClick={() => router.push("/tournaments")}
      >
        ← Back to tournaments
      </button>

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
            <button className="btn btn-secondary text-sm" disabled={busy} onClick={() => setDealOpen(true)}>
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

      {/* Status + rebuy window */}
      <div className="card flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm muted">{alive.length} alive · {entries.length} entrants</span>
        </div>
        {t.rebuys_allowed ? (
          <div className="flex items-center gap-2">
            <Toggle
              checked={t.rebuy_window_open}
              onChange={next => act("set_rebuy_window", { open: next })}
              label={t.rebuy_window_open ? "Rebuys open" : "Rebuys closed"}
              size="sm"
              labelPosition="right"
              className="text-sm"
              disabled={busy}
            />
          </div>
        ) : (
          <span className="text-xs muted">Rebuys not allowed</span>
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
            <button className="btn btn-secondary text-sm" disabled={busy} onClick={() => setRedrawWarn(true)}>Re-draw seats</button>
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
            <h3 className="text-sm font-semibold muted mb-2">Busted ({busted.length})</h3>
            <ul className="space-y-1">
              {busted.map(e => (
                <li key={e.player_id} className="flex items-center justify-between gap-2 text-sm rounded px-2 py-1" style={{ background: "var(--bg)" }}>
                  <span className="truncate">{nameById.get(e.player_id) ?? "?"}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="muted text-xs">
                      {ordinal(e.finish_position!)}
                      {e.payout > 0 ? ` · €${e.payout.toFixed(2)}` : ""}
                      {e.buy_ins > 1 ? ` · ${e.buy_ins} buy-ins` : ""}
                    </span>
                    <button
                      className="btn-secondary text-xs px-2 py-0.5 rounded border border-[var(--border)]"
                      disabled={busy}
                      title="Undo this bust-out — returns the player to the field"
                      onClick={() => act("undo_bust", { player_id: e.player_id })}
                    >
                      Undo
                    </button>
                  </span>
                </li>
              ))}
              {busted.length === 0 && <li className="muted text-sm">No bust-outs yet.</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Primary actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn" disabled={busy || alive.length === 0} onClick={() => setBustOpen(true)}>Add bust-out</button>
        <button className="btn btn-secondary ml-auto" disabled={busy} onClick={() => setFinishOpen(true)}>Finish tournament</button>
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
            await act("rebalance_move", { player_id: moverId, to_table: toTable, from_button_seat: fromButtonSeat });
            setMoveOpen(null);
          }}
        />
      )}

      {dealOpen && (
        <DealDialog
          rows={podium}
          prizePool={prizePool}
          hasDeal={hasDeal}
          busy={busy}
          onClose={() => setDealOpen(false)}
          onSave={async overrides => { await act("set_deal", { overrides }); setDealOpen(false); }}
          onClear={async () => { await act("set_deal", { overrides: null }); setDealOpen(false); }}
        />
      )}

      <ConfirmDialog
        open={finishOpen}
        title="Finish this tournament?"
        message="This marks the tournament Finished and includes it in the stats. The last player still in is recorded as 1st place; finishing positions you've recorded become final."
        confirmLabel="Finish"
        cancelLabel="Keep playing"
        busy={busy}
        onCancel={() => setFinishOpen(false)}
        onConfirm={async () => { await act("finish", {}); setFinishOpen(false); router.push("/tournaments"); }}
      />
    </div>
  );

  // ---- Rebalance action helpers ----
  function buildBreakAssignments(breakTableNo: number): SeatAssignment[] {
    const next = applyBreak(layout, breakTableNo);
    const out: SeatAssignment[] = [];
    for (const tbl of next.tables) {
      tbl.occupants.forEach((pid, i) => out.push({ player_id: pid, table_no: tbl.table_no, seat_no: i + 1 }));
    }
    return out.filter(a => a.table_no !== breakTableNo);
  }
  async function doBreak(breakTableNo: number) {
    await act("break_table", { break_table: breakTableNo, assignments: buildBreakAssignments(breakTableNo) });
  }
  async function doFinalTable(intoTable: number) {
    // Collapse every alive seated player onto one table, preserving ring order.
    const ordered = layout.tables.flatMap(tbl => tbl.occupants);
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
 */
function DealDialog({
  rows, prizePool, hasDeal, busy, onClose, onSave, onClear,
}: {
  rows: PodiumRow[];
  prizePool: number;
  hasDeal: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (overrides: Record<string, number>) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [amounts, setAmounts] = useState<Record<number, number>>(
    () => Object.fromEntries(rows.map(r => [r.position, Math.round(r.amount * 100) / 100])),
  );
  const total = rows.reduce((s, r) => s + (amounts[r.position] ?? 0), 0);
  const diff = total - prizePool;
  const balanced = Math.abs(diff) < 0.01;

  return (
    <Modal title="Make a deal" onClose={onClose}>
      <p className="muted text-sm mb-3">
        Set the euro amount each finishing position pays. The total must equal the prize pool
        (€{prizePool.toFixed(2)}).
      </p>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.position} className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
              style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              {r.position}
            </span>
            <span className={r.player_id ? "text-sm flex-1 truncate" : "text-sm flex-1 truncate muted"}>
              {r.player_id ? r.name : "Not decided yet"}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="muted text-sm">€</span>
              <NumberInput
                className="input w-28 text-right"
                allowDecimal
                value={amounts[r.position] ?? 0}
                onChange={n => setAmounts(prev => ({ ...prev, [r.position]: n ?? 0 }))}
              />
            </div>
          </li>
        ))}
      </ul>

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
          onClick={() => onSave(Object.fromEntries(rows.map(r => [String(r.position), amounts[r.position] ?? 0])))}
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
