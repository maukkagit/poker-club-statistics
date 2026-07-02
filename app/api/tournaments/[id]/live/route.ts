import { NextResponse } from "next/server";
import {
  assignSeats, setRebuyWindow, setSoundSettings, recordBuyin, recordBust, addPlayer, removePlayer, undoLatestBust, setDeal,
  rebalanceMove, breakTable, finishTournament, restartTournament, updateTournamentInfo, startClock, setClockRunning, adjustClock,
  setClockElapsed, setStructure,
  getTournament, listEntriesFor, getPlayerNames, addSystemChatMessage,
  type SeatAssignmentRow,
} from "@/lib/db";
import { rpcErrorResponse } from "@/lib/http/rpc-errors";
import { broadcastTournamentChanged, broadcastChatChanged } from "@/lib/realtime";
import { parseStructure } from "@/lib/db/mappers";
import { deriveClockView } from "@/lib/tournament-clock";
import { bountyPhaseAt } from "@/lib/pko";
import { bustMessages, rebuyMessage, bustedByMessage, knockoutWonMessage, knockoutSecuredMessage } from "@/lib/tournament-chat-events";
import type { Seating, Tournament } from "@/lib/types";

/**
 * Post the automated "TD" chat announcement for a bust-out / re-entry, then
 * nudge the chat channel. Best-effort: never throws into the action response
 * (chat is a side effect, not part of the atomic mutation). PKO tournaments use
 * eliminator-aware phrasing ("X was busted out by Y"); normal tournaments use
 * the place/re-entry phrasing.
 */
async function announceBustOrRebuy(
  t: Tournament, playerId: string, action: "record_bust" | "record_buyin",
  eliminatorIds: string[],
) {
  try {
    const entries = await listEntriesFor(t.id);
    const names = await getPlayerNames(entries.map(e => e.player_id).concat(eliminatorIds));
    const nameOf = (pid: string) => names.get(pid) || "A player";
    const busted = entries.find(e => e.player_id === playerId);
    const aliveAfter = entries.filter(e => e.finish_position == null).length;
    // This bust crowned the last survivor (runner-up took 2nd, winner is 1st).
    const winner = action === "record_bust" && aliveAfter === 0 && busted?.finish_position === 2
      ? entries.find(e => e.finish_position === 1) ?? null
      : null;

    let bodies: string[];
    if (t.is_pko && eliminatorIds.length > 0) {
      // 1) the knockout line, then 2) a follow-up: when this bust ended the
      // tournament, the runner-up's finish line followed by the champion line;
      // otherwise a paid-finish line when the busted player landed in the money.
      bodies = [bustedByMessage(nameOf(playerId), eliminatorIds.map(nameOf), action === "record_buyin")];
      if (winner) {
        const finish = busted?.finish_position ?? null;
        if (finish != null) bodies.push(knockoutSecuredMessage(nameOf(playerId), finish));
        bodies.push(knockoutWonMessage(nameOf(winner.player_id)));
      } else if (action === "record_bust") {
        const paidPositions = new Set((t.payout_structure ?? []).map(s => s.position));
        const finish = busted?.finish_position ?? null;
        if (finish != null && paidPositions.has(finish)) {
          bodies.push(knockoutSecuredMessage(nameOf(playerId), finish));
        }
      }
    } else if (action === "record_buyin") {
      bodies = [rebuyMessage(nameOf(playerId))];
    } else {
      const paidPositions = new Set((t.payout_structure ?? []).map(s => s.position));
      bodies = bustMessages({
        bustedName: nameOf(playerId),
        bustedFinish: busted?.finish_position ?? null,
        paidPositions,
        champion: winner ? { name: nameOf(winner.player_id), finish: 1 } : null,
      });
    }

    for (const body of bodies) await addSystemChatMessage(t.id, body);
    if (t.share_token) await broadcastChatChanged(t.share_token);
  } catch {
    /* chat announcement is best-effort; swallow errors */
  }
}

export const dynamic = "force-dynamic";

/**
 * Live-tournament action dispatcher. Every action is a single atomic,
 * version-checked Postgres RPC; the body carries `expected_version` and the
 * response returns the new `version`, which the client threads into its next
 * call. A version mismatch comes back as HTTP 409.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const body = await req.json();
  const action = String(body.action ?? "");
  const ev = Number(body.expected_version ?? 0);
  // A `null`/absent expected_version means "don't version-check" — used by
  // system-driven actions (e.g. clock-triggered rebuy auto-close) that must not
  // conflict with a concurrent user edit. _assert_version treats null as a skip.
  const evOrNull = body.expected_version == null ? null : ev;

  try {
    // For bust/re-entry, resolve the PKO context up front: load the tournament,
    // derive the current bounty phase from the live clock, and pick up the
    // eliminator from the body (PKO only). Reused by the chat announcement.
    let pko: { tournament: Tournament; eliminatorIds: string[]; phase: "pre" | "bounty" } | null = null;
    if (action === "record_bust" || action === "record_buyin") {
      const t = await getTournament(id);
      if (t) {
        const view = deriveClockView(t.structure ?? [], t.clock ?? null, Date.now());
        const phase = bountyPhaseAt(view.levelNumber, t.bounty_start_level);
        // Accept either a single `eliminator_player_id` or an ordered
        // `eliminator_player_ids` array (split pots, odd-chip priority first).
        const raw: unknown = body.eliminator_player_ids ?? body.eliminator_player_id;
        const ids = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
          .map(String).filter(Boolean);
        const eliminatorIds = t.is_pko ? ids : [];
        pko = { tournament: t, eliminatorIds, phase };
      }
    }

    let version: number;
    switch (action) {
      case "assign_seats":
        version = await assignSeats(
          id, body.seating as Seating, (body.assignments ?? []) as SeatAssignmentRow[], ev,
        );
        break;
      case "set_rebuy_window":
        version = await setRebuyWindow(id, !!body.open, evOrNull);
        break;
      case "set_sound":
        version = await setSoundSettings(id, !!body.enabled, !!body.knockouts, ev);
        break;
      case "record_buyin": {
        const ids = pko?.eliminatorIds ?? [];
        version = await recordBuyin(id, String(body.player_id), ev, ids.length ? ids : null, ids.length ? pko!.phase : null);
        break;
      }
      case "record_bust": {
        const ids = pko?.eliminatorIds ?? [];
        version = await recordBust(id, String(body.player_id), ev, ids.length ? ids : null, ids.length ? pko!.phase : null);
        break;
      }
      case "add_player":
        version = await addPlayer(
          id, String(body.player_id),
          body.table_no == null ? null : Number(body.table_no),
          body.seat_no == null ? null : Number(body.seat_no),
          ev,
        );
        break;
      case "remove_player":
        version = await removePlayer(id, String(body.player_id), ev);
        break;
      case "undo_latest_bust":
        version = await undoLatestBust(id, ev);
        break;
      case "set_deal":
        version = await setDeal(
          id,
          body.overrides == null ? null : (body.overrides as Record<string, number>),
          ev,
        );
        break;
      case "rebalance_move":
        version = await rebalanceMove(
          id, String(body.player_id), Number(body.to_table), Number(body.to_seat),
          body.from_button_seat == null ? null : Number(body.from_button_seat), ev,
        );
        break;
      case "break_table":
        version = await breakTable(
          id, Number(body.break_table), (body.assignments ?? []) as SeatAssignmentRow[], ev,
        );
        break;
      case "finish":
        version = await finishTournament(id, ev);
        break;
      case "restart_tournament":
        version = await restartTournament(id, ev);
        break;
      case "update_tournament_info":
        version = await updateTournamentInfo(id, (body.patch ?? {}) as Record<string, unknown>, ev);
        break;
      case "start_clock":
        version = await startClock(id, ev);
        break;
      case "set_clock_running":
        version = await setClockRunning(id, !!body.running, ev);
        break;
      case "adjust_clock":
        version = await adjustClock(id, Number(body.delta_ms), ev);
        break;
      case "set_clock_elapsed":
        version = await setClockElapsed(id, Number(body.elapsed_ms), !!body.running, ev);
        break;
      case "set_structure":
        version = await setStructure(
          id,
          parseStructure(body.structure),
          body.starting_stack == null || body.starting_stack === "" ? null : Number(body.starting_stack),
          ev,
        );
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    // Best-effort realtime nudge so public clock viewers refetch immediately;
    // they also poll, so we never block the response on this.
    void broadcastTournamentChanged(id);
    // Automated "TD" chat announcements for bust-outs / re-entries.
    if ((action === "record_bust" || action === "record_buyin") && pko) {
      await announceBustOrRebuy(pko.tournament, String(body.player_id), action, pko.eliminatorIds);
    }
    return NextResponse.json({ version });
  } catch (e) {
    const { status, error } = rpcErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }
}
