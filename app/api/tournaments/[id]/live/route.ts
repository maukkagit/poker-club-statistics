import { NextResponse } from "next/server";
import {
  assignSeats, setRebuyWindow, recordBuyin, recordBust, addPlayer, undoLatestBust, setDeal,
  rebalanceMove, breakTable, finishTournament, startClock, setClockRunning, adjustClock,
  setClockElapsed, setStructure,
  type SeatAssignmentRow,
} from "@/lib/db";
import { rpcErrorResponse } from "@/lib/http/rpc-errors";
import { broadcastTournamentChanged } from "@/lib/realtime";
import { parseStructure } from "@/lib/db/mappers";
import type { Seating } from "@/lib/types";

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

  try {
    let version: number;
    switch (action) {
      case "assign_seats":
        version = await assignSeats(
          id, body.seating as Seating, (body.assignments ?? []) as SeatAssignmentRow[], ev,
        );
        break;
      case "set_rebuy_window":
        version = await setRebuyWindow(id, !!body.open, ev);
        break;
      case "record_buyin":
        version = await recordBuyin(id, String(body.player_id), ev);
        break;
      case "record_bust":
        version = await recordBust(id, String(body.player_id), ev);
        break;
      case "add_player":
        version = await addPlayer(
          id, String(body.player_id),
          body.table_no == null ? null : Number(body.table_no),
          body.seat_no == null ? null : Number(body.seat_no),
          ev,
        );
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
    return NextResponse.json({ version });
  } catch (e) {
    const { status, error } = rpcErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }
}
