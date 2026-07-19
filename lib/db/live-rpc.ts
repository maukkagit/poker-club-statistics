// Live-tournament RPCs (issue #20).
// Every compound, multi-row change goes through a version-checked Postgres
// function (see supabase/migrations/0002_seating.sql) so writes are atomic and
// a stale client surfaces a conflict instead of clobbering concurrent edits.
import type { PayoutSlot, PayoutTier, Seating, StructureRow } from "@/lib/types";
import { supabase } from "@/lib/supabase";

/**
 * Error thrown by an RPC wrapper. `code` is the Postgres SQLSTATE and
 * `message` is the symbolic reason we raised inside the function
 * (e.g. "version_conflict"). API routes map these to HTTP statuses.
 */
export class RpcError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

async function callRpc(fn: string, args: Record<string, any>): Promise<any> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new RpcError(error.message, (error as any).code ?? "");
  return data;
}

export type SeatAssignmentRow = { player_id: string; table_no: number; seat_no: number };

export type CreateWithSeatingPayload = {
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  notes?: string;
  location_id: string;
  special?: boolean;
  rebuys_allowed?: boolean;
  // Whether add-ons are offered for this tournament (see `Tournament.addons_allowed`).
  addons_allowed?: boolean;
  // Add-on price/chip-grant config. Omit to let the RPC default them to the
  // full entry price and the starting stack respectively.
  addon_price?: number;
  addon_chips?: number;
  entries: { player_id: string; bucket?: number | null }[];
  seating?: Seating | null;
  assignments?: SeatAssignmentRow[] | null;
  // Tournament clock (issue #21): the blind/break ladder and starting stack
  // configured in the wizard's Structure step. Optional — a tournament can be
  // created without a clock.
  structure?: StructureRow[];
  starting_stack?: number | null;
  // Level at which re-entries auto-close. Null = managed manually.
  rebuy_close_level?: number | null;
  // Dynamic (entry-scaled) payouts. When on, `payout_structure` above is just
  // the resolved starting-count split; the DB re-materializes it from
  // `payout_tiers` as the field grows.
  dynamic_payouts?: boolean;
  payout_tiers?: PayoutTier[];
  // Progressive knockout (PKO) config. When `is_pko`, `buy_in_amount` is the
  // regular prize-pool contribution and `bounty_start_amount` is the starting
  // bounty per buy-in; the bounty phase begins at `bounty_start_level`.
  is_pko?: boolean;
  bounty_start_amount?: number;
  bounty_start_level?: number | null;
  bounty_chip?: number;
};

/** Create an Active tournament + entries (+ optional seating) atomically. */
export async function createTournamentWithSeating(payload: CreateWithSeatingPayload): Promise<string> {
  return callRpc("create_tournament_with_seating", { payload });
}

/** Draw-later / re-draw: replace the seat assignment atomically. */
export async function assignSeats(
  tournamentId: string, seating: Seating, assignments: SeatAssignmentRow[], expectedVersion: number,
): Promise<number> {
  return callRpc("assign_seats", {
    p_tournament_id: tournamentId, p_seating: seating, p_assignments: assignments, p_expected_version: expectedVersion,
  });
}

export async function setRebuyWindow(
  tournamentId: string, open: boolean, expectedVersion: number | null,
): Promise<number> {
  return callRpc("set_rebuy_window", { p_tournament_id: tournamentId, p_open: open, p_expected_version: expectedVersion });
}

/**
 * Director config for whether add-ons are offered plus their price (EUR) and
 * chip grant. Free-standing (like `setSoundSettings`): can be changed at any
 * point in an Active tournament's life, not just pre-play — lives in the
 * console's Settings → Format & players tab. Any change is rejected
 * server-side once any player has actually bought one (unless it's a no-op).
 */
export async function setAddonConfig(
  tournamentId: string, allowed: boolean, price: number, chips: number, expectedVersion: number,
): Promise<number> {
  return callRpc("set_addon_config", {
    p_tournament_id: tournamentId, p_allowed: allowed, p_price: price, p_chips: chips,
    p_expected_version: expectedVersion,
  });
}

/** Record a player taking an add-on (chip top-up). Any player still in may take
 * one — unlike a rebuy, there's no chip-count gate. */
export async function recordAddon(
  tournamentId: string, playerId: string, expectedVersion: number,
): Promise<number> {
  return callRpc("record_addon", {
    p_tournament_id: tournamentId, p_player_id: playerId, p_expected_version: expectedVersion,
  });
}

/** Director toggle for viewer-link clock sound effects (master + knockout sting). */
export async function setSoundSettings(
  tournamentId: string, enabled: boolean, knockouts: boolean, expectedVersion: number,
): Promise<number> {
  return callRpc("set_sound_settings", {
    p_tournament_id: tournamentId, p_enabled: enabled, p_knockouts: knockouts, p_expected_version: expectedVersion,
  });
}

/** Director toggle for the viewer-link animated title/prize gradient. */
export async function setTitleGradient(
  tournamentId: string, enabled: boolean, expectedVersion: number,
): Promise<number> {
  return callRpc("set_title_gradient", {
    p_tournament_id: tournamentId, p_enabled: enabled, p_expected_version: expectedVersion,
  });
}

/**
 * Re-entry: a busted player buys back in (buy_ins + 1). For PKO, pass the
 * `eliminatorPlayerId` who busted them and the bounty `phase` at that moment so
 * the knockout is logged (and their bounty transfers + resets). Non-PKO callers
 * pass null for both.
 */
export async function recordBuyin(
  tournamentId: string, playerId: string, expectedVersion: number,
  eliminatorPlayerIds: string[] | null = null, phase: "pre" | "bounty" | null = null,
): Promise<number> {
  return callRpc("record_buyin", {
    p_tournament_id: tournamentId, p_player_id: playerId,
    p_eliminator_player_ids: eliminatorPlayerIds, p_phase: phase,
    p_expected_version: expectedVersion,
  });
}

/**
 * Bust-out: mark a player eliminated. For PKO, pass the `eliminatorPlayerIds`
 * who busted them (one, or several ordered by odd-chip priority when a chopped
 * pot splits the bounty) and the bounty `phase` so the knockout(s) are logged.
 * Non-PKO callers pass null for both.
 */
export async function recordBust(
  tournamentId: string, playerId: string, expectedVersion: number,
  eliminatorPlayerIds: string[] | null = null, phase: "pre" | "bounty" | null = null,
): Promise<number> {
  return callRpc("record_bust", {
    p_tournament_id: tournamentId, p_player_id: playerId,
    p_eliminator_player_ids: eliminatorPlayerIds, p_phase: phase,
    p_expected_version: expectedVersion,
  });
}

/**
 * Late entry: add a new player to an Active tournament while rebuys are open.
 * `tableNo`/`seatNo` are both null (unseated) or both set (a random open seat
 * the caller picked). Rejected unless rebuys are active.
 */
export async function addPlayer(
  tournamentId: string, playerId: string,
  tableNo: number | null, seatNo: number | null, expectedVersion: number,
): Promise<number> {
  return callRpc("add_player", {
    p_tournament_id: tournamentId, p_player_id: playerId,
    p_table_no: tableNo, p_seat_no: seatNo, p_expected_version: expectedVersion,
  });
}

export async function undoLatestBust(tournamentId: string, expectedVersion: number): Promise<number> {
  return callRpc("undo_latest_bust", { p_tournament_id: tournamentId, p_expected_version: expectedVersion });
}

/**
 * Remove a late entry (a player added live by mistake). Soft-deletes the entry;
 * rejected for original entrants, finished players, or anyone already in the
 * knockout ledger.
 */
export async function removePlayer(tournamentId: string, playerId: string, expectedVersion: number): Promise<number> {
  return callRpc("remove_player", {
    p_tournament_id: tournamentId, p_player_id: playerId, p_expected_version: expectedVersion,
  });
}

/** Record/clear a "deal" — pass null to clear. Validated to sum to the pool. */
export async function setDeal(
  tournamentId: string, overrides: Record<string, number> | null, expectedVersion: number,
): Promise<number> {
  return callRpc("set_deal", { p_tournament_id: tournamentId, p_overrides: overrides, p_expected_version: expectedVersion });
}

export async function rebalanceMove(
  tournamentId: string, playerId: string, toTable: number, toSeat: number,
  fromButtonSeat: number | null, expectedVersion: number,
): Promise<number> {
  return callRpc("rebalance_move", {
    p_tournament_id: tournamentId, p_player_id: playerId, p_to_table: toTable, p_to_seat: toSeat,
    p_from_button_seat: fromButtonSeat, p_expected_version: expectedVersion,
  });
}

export async function breakTable(
  tournamentId: string, breakTableNo: number, assignments: SeatAssignmentRow[], expectedVersion: number,
): Promise<number> {
  return callRpc("break_table", {
    p_tournament_id: tournamentId, p_break_table: breakTableNo, p_assignments: assignments, p_expected_version: expectedVersion,
  });
}

export async function finishTournament(tournamentId: string, expectedVersion: number): Promise<number> {
  return callRpc("finish_tournament", { p_tournament_id: tournamentId, p_expected_version: expectedVersion });
}

/**
 * Edit a live tournament's setup (the "Start a tournament" wizard's Info-step
 * fields) and, optionally, the player roster (`player_ids`). Only the keys
 * present in `patch` are changed. Once the clock has started the RPC accepts
 * only the basic metadata keys (date/name/notes/location_id/special) and
 * rejects the rest with `play_already_started`.
 */
export async function updateTournamentInfo(
  tournamentId: string, patch: Record<string, unknown>, expectedVersion: number,
): Promise<number> {
  return callRpc("update_tournament_info", {
    p_tournament_id: tournamentId, p_patch: patch, p_expected_version: expectedVersion,
  });
}

/**
 * Restart a live tournament: rewind every action taken since creation — the
 * clock, the seat draw and rebalancing, all busts / re-entries, any deal, and
 * all late entries — back to a fresh Active, not-started state. Keeps the
 * tournament configuration (structure, stack, payouts, PKO, rebuys, sounds).
 * Destructive: the previous run's standings, knockouts, undo history and chat
 * feed are discarded.
 */
export async function restartTournament(tournamentId: string, expectedVersion: number): Promise<number> {
  return callRpc("restart_tournament", { p_tournament_id: tournamentId, p_expected_version: expectedVersion });
}

// ---------------------------------------------------------------------------
// Tournament clock (issue #21)
// ---------------------------------------------------------------------------

/** Begin (or restart) the clock from zero, running. */
export async function startClock(tournamentId: string, expectedVersion: number): Promise<number> {
  return callRpc("start_clock", { p_tournament_id: tournamentId, p_expected_version: expectedVersion });
}

/** Pause (running=false) or resume (running=true) the clock. */
export async function setClockRunning(tournamentId: string, running: boolean, expectedVersion: number): Promise<number> {
  return callRpc("set_clock_running", { p_tournament_id: tournamentId, p_running: running, p_expected_version: expectedVersion });
}

/** Rewind (negative) or fast-forward (positive) by `deltaMs`, clamped to the structure. */
export async function adjustClock(tournamentId: string, deltaMs: number, expectedVersion: number): Promise<number> {
  return callRpc("adjust_clock", { p_tournament_id: tournamentId, p_delta_ms: deltaMs, p_expected_version: expectedVersion });
}

/** Seek the clock to an absolute position (clamped) and set the running flag. */
export async function setClockElapsed(
  tournamentId: string, elapsedMs: number, running: boolean, expectedVersion: number,
): Promise<number> {
  return callRpc("set_clock_elapsed", {
    p_tournament_id: tournamentId, p_elapsed_ms: elapsedMs, p_running: running, p_expected_version: expectedVersion,
  });
}

/** Replace the blind/break structure (and starting stack) of a live tournament. */
export async function setStructure(
  tournamentId: string, structure: StructureRow[], startingStack: number | null, expectedVersion: number,
): Promise<number> {
  return callRpc("set_structure", {
    p_tournament_id: tournamentId, p_structure: structure,
    p_starting_stack: startingStack, p_expected_version: expectedVersion,
  });
}
