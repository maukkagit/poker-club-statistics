// HTTP mapping for live-tournament RPC failures. Lives in the http layer (not
// the data layer) since it translates domain errors into client-facing status
// codes + messages. Consumed by the live + start tournament API routes.

/** Map a thrown RpcError to an HTTP status + client-facing message. */
export function rpcErrorResponse(e: unknown): { status: number; error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("version_conflict")) {
    return { status: 409, error: "This tournament was updated elsewhere — refresh and try again." };
  }
  if (msg.includes("not_found")) {
    return { status: 404, error: "Tournament not found." };
  }
  if (msg.includes("rebuys_not_active")) {
    return { status: 409, error: "Rebuys are closed for this tournament." };
  }
  if (msg.includes("rebuys_not_allowed")) {
    return { status: 400, error: "Rebuys were not enabled for this tournament." };
  }
  if (msg.includes("rebuys_locked_after_itm")) {
    return { status: 409, error: "Rebuys can't reopen once a paid position is decided — undo bustouts past the money bubble first." };
  }
  if (msg.includes("addons_not_allowed")) {
    return { status: 400, error: "Add-ons are not enabled for this tournament." };
  }
  if (msg.includes("addons_locked_has_purchases")) {
    return { status: 409, error: "Add-on config is locked — at least one player has already bought one." };
  }
  if (msg.includes("add_locked_after_itm")) {
    return { status: 409, error: "Players can't be added once a paid position is decided." };
  }
  if (msg.includes("player_already_busted")) {
    return { status: 409, error: "That player has already busted." };
  }
  if (msg.includes("player_already_entered")) {
    return { status: 409, error: "That player is already in this tournament." };
  }
  if (msg.includes("seat_both_or_neither")) {
    return { status: 400, error: "A seat needs both a table and a seat number." };
  }
  if (msg.includes("no_bust_to_undo")) {
    return { status: 409, error: "There's no bustout to undo." };
  }
  if (msg.includes("play_already_started")) {
    return { status: 409, error: "Play has started — restart the tournament to change its setup." };
  }
  if (msg.includes("cannot_remove_original_entry")) {
    return { status: 409, error: "Only players added during the tournament can be removed." };
  }
  if (msg.includes("cannot_remove_finished_player")) {
    return { status: 409, error: "That player already has a finishing position — undo their bustout first." };
  }
  if (msg.includes("cannot_remove_player_with_knockouts")) {
    return { status: 409, error: "That player is already part of the knockout history and can't be removed." };
  }
  if (msg.includes("deal_must_sum_to_pool")) {
    return { status: 400, error: "Deal amounts must add up to the current prize pool." };
  }
  if (msg.includes("structure cannot be empty")) {
    return { status: 400, error: "Add at least one blind level before saving the structure." };
  }
  if (msg.includes("player_not_seated")) {
    return { status: 400, error: "That player is not seated." };
  }
  if (msg.includes("entry_not_found")) {
    return { status: 404, error: "Player is not in this tournament." };
  }
  if (msg.startsWith("payout_structure") || msg.includes("location_id is required")) {
    return { status: 400, error: msg.includes("location_id") ? "Location is required" : msg };
  }
  return { status: 500, error: msg || "Operation failed" };
}
