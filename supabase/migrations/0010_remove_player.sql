-- Poker Club Statistics — remove an accidentally-added late entry.
--
-- Run once in the Supabase SQL editor after 0009_pko.sql. Idempotent.
--
-- Adds a `late_entry` flag to entries (set by add_player) so the live manager
-- can tell apart players added during play from those entered at creation, and
-- a `remove_player` RPC that soft-deletes ONLY a late entry — letting a director
-- undo a wrong "Add bustout"/late-entry pick without ever touching a player who
-- has been in since the tournament was created.

-- ---------------------------------------------------------------------------
-- entries.late_entry
-- ---------------------------------------------------------------------------
-- Existing rows (created at tournament setup) default to false. add_player
-- stamps true going forward. Only true rows are removable.
alter table entries
  add column if not exists late_entry boolean not null default false;

-- ---------------------------------------------------------------------------
-- add_player — now marks the new entry as a late entry [supersedes 0003]
-- ---------------------------------------------------------------------------
create or replace function add_player(
  p_tournament_id uuid,
  p_player_id uuid,
  p_table_no smallint,
  p_seat_no smallint,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_active boolean;
  v_exists boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Late entries are only possible while rebuys are open — same gate as a rebuy.
  select (rebuys_allowed and rebuy_window_open) into v_active
    from tournaments where id = p_tournament_id;
  if not coalesce(v_active, false) then
    raise exception 'rebuys_not_active' using errcode = 'P0001';
  end if;

  -- Refuse duplicates: a player already in this tournament (alive or busted)
  -- must not get a second entry.
  select exists(
    select 1 from entries
     where tournament_id = p_tournament_id
       and player_id = p_player_id
       and deleted_at is null
  ) into v_exists;
  if v_exists then
    raise exception 'player_already_entered' using errcode = 'P0001';
  end if;

  -- Seat coordinates are both-or-neither (enforced by a CHECK constraint too).
  if (p_table_no is null) <> (p_seat_no is null) then
    raise exception 'seat_both_or_neither' using errcode = 'P0001';
  end if;

  insert into entries (tournament_id, player_id, buy_ins, table_no, seat_no, late_entry)
  values (p_tournament_id, p_player_id, 1, p_table_no, p_seat_no, true);

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- remove_player(tournament_id, player_id, expected_version)
-- ---------------------------------------------------------------------------
-- Soft-deletes a late entry (frees their seat, drops their buy-in from the
-- pool). Guards keep it to a genuine "oops, wrong player" correction:
--   * the entry must exist and be a late_entry (never an original entrant),
--   * they must still be in (no finishing position recorded),
--   * they must not appear in the PKO knockout ledger (as hunter or victim),
--     so removing them can't corrupt derived bounty math.
create or replace function remove_player(
  p_tournament_id uuid,
  p_player_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_late boolean;
  v_finished boolean;
  v_has_ko boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select late_entry, (finish_position is not null)
    into v_late, v_finished
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;
  if v_late is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if not v_late then
    raise exception 'cannot_remove_original_entry' using errcode = 'P0001';
  end if;
  if v_finished then
    raise exception 'cannot_remove_finished_player' using errcode = 'P0001';
  end if;

  select exists(
    select 1 from knockouts
     where tournament_id = p_tournament_id
       and (eliminator_player_id = p_player_id or eliminated_player_id = p_player_id)
  ) into v_has_ko;
  if v_has_ko then
    raise exception 'cannot_remove_player_with_knockouts' using errcode = 'P0001';
  end if;

  update entries
     set deleted_at = now(), table_no = null, seat_no = null
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;
