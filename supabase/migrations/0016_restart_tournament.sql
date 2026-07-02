-- Poker Club Statistics — restart a live tournament.
--
-- Run once in the Supabase SQL editor after 0015_undo_reentry.sql. Idempotent.
--
-- A single, version-checked RPC that rewinds a live tournament all the way back
-- to its just-created state: it undoes every action taken since creation
-- (the clock, the seat draw and all rebalancing, every bust / re-entry, any
-- deal, and all late entries) while KEEPING the tournament's configuration
-- (structure, starting stack, payouts, PKO settings, rebuys_allowed, sounds,
-- share token). The field is reset to the original entrants, each on a single
-- buy-in and unseated, ready for a fresh draw and clock start.
--
-- This is intentionally destructive: the previous run's standings, knockout
-- ledger, undo history and chat feed are all discarded. It cannot be undone.

-- ---------------------------------------------------------------------------
-- restart_tournament(tournament_id, expected_version)
-- ---------------------------------------------------------------------------
create or replace function restart_tournament(
  p_tournament_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Drop players who were added live after creation (late entries) — they were
  -- not part of the tournament as it was created. Soft-delete, mirroring
  -- remove_player, so their buy-in leaves the pool.
  update entries
     set deleted_at = now()
   where tournament_id = p_tournament_id
     and late_entry = true
     and deleted_at is null;

  -- Reset the remaining (original) entrants to a single buy-in, unseated, with
  -- no standings and no per-entry payout override.
  update entries
     set buy_ins = 1,
         finish_position = null,
         table_no = null,
         seat_no = null,
         payout_override = null
   where tournament_id = p_tournament_id
     and deleted_at is null;

  -- Discard the whole per-run history: knockout ledger, undo snapshots, and the
  -- chat / event feed.
  delete from knockouts where tournament_id = p_tournament_id;
  delete from tournament_undo where tournament_id = p_tournament_id;
  delete from chat_messages where tournament_id = p_tournament_id;

  -- Reset the tournament itself to a fresh, Active, not-yet-started state,
  -- keeping all configuration. The clock matches what create_tournament_with_seating
  -- seeds (not started); seating (the draw) and any deal are cleared.
  update tournaments
     set state = 'Active',
         seating = null,
         payout_overrides = null,
         rebuy_window_open = true,
         clock = jsonb_build_object(
           'started', false,
           'running', false,
           'elapsed_ms', 0,
           'updated_at', null
         ),
         version = v_version + 1
   where id = p_tournament_id;

  return v_version + 1;
end;
$$;
