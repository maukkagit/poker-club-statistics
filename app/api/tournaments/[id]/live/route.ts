import { NextResponse } from "next/server";
import {
  assignSeats, setRebuyWindow, recordBuyin, recordBust, undoBust, setDeal,
  rebalanceMove, breakTable, finishTournament,
  rpcErrorResponse, type SeatAssignmentRow,
} from "@/lib/db";
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
      case "undo_bust":
        version = await undoBust(id, String(body.player_id), ev);
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
          id, String(body.player_id), Number(body.to_table),
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
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    return NextResponse.json({ version });
  } catch (e) {
    const { status, error } = rpcErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }
}
