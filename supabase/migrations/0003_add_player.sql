-- Poker Club Statistics — late entry + auto-closing rebuys on the money bubble.
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`) after
-- 0002_seating.sql. It is idempotent: safe to re-run. It (re)defines two RPCs;
-- because migrations run in order, these definitions supersede the originals
-- from 0002.
--
-- 1. add_player: a late entrant is a fresh entry with a single buy-in,
--    optionally seated into a specific open seat the caller picked at random
--    (the partial unique index `entries_seat_uniq` rejects a collision). Only
--    allowed while rebuys are ACTIVE, mirroring `record_buyin`.
-- 2. record_bust: same as 0002, plus it auto-closes the rebuy window the moment
--    a player finishes in a paid position (the money bubble bursts), unless the
--    director already closed it. This stops late entries / rebuys once real
--    money is on the line.
-- 3. set_rebuy_window: same as 0002, plus it refuses to RE-OPEN the window while
--    any paid position is already determined. To re-open, the director must
--    first undo bust-outs until no paid place is filled.

-- ---------------------------------------------------------------------------
-- add_player(tournament_id, player_id, table_no?, seat_no?, expected_version)
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

  insert into entries (tournament_id, player_id, buy_ins, table_no, seat_no)
  values (p_tournament_id, p_player_id, 1, p_table_no, p_seat_no);

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_bust(tournament_id, player_id, expected_version)  [supersedes 0002]
-- ---------------------------------------------------------------------------
-- Identical to the 0002 definition (assign the finishing place from the bottom
-- up, leave the seat empty, auto-crown a lone survivor, snapshot for undo) with
-- one addition: after the bust, if any finished player now sits in a paid
-- position (a position listed in payout_structure), close the rebuy window —
-- but only if it's still open, so a manual close is never reverted. Once real
-- money is locked in, rebuys and late entries should stop.
create or replace function record_bust(
  p_tournament_id uuid,
  p_player_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_alive int;
  v_already boolean;
  v_winner uuid;
  v_in_money boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select (finish_position is not null)
    into v_already
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;
  if v_already is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_already then
    raise exception 'player_already_busted' using errcode = 'P0001';
  end if;

  perform _snapshot(p_tournament_id, 'record_bust');

  -- Alive count *including* the busting player == their finishing place.
  select count(*) into v_alive
    from entries
   where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;

  update entries
     set finish_position = v_alive, table_no = null, seat_no = null
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  -- Down to one — crown the survivor 1st place.
  if v_alive - 1 = 1 then
    select player_id into v_winner
      from entries
     where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;
    if v_winner is not null then
      update entries set finish_position = 1, table_no = null, seat_no = null
       where tournament_id = p_tournament_id and player_id = v_winner and deleted_at is null;
    end if;
  end if;

  -- Money bubble: if anyone now holds a paid finishing position, close the
  -- rebuy window (no-op if already closed, so a manual close stands).
  select exists(
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      join jsonb_array_elements(t.payout_structure) slot
        on (slot->>'position')::int = e.finish_position
     where e.tournament_id = p_tournament_id and e.deleted_at is null
  ) into v_in_money;
  if v_in_money then
    update tournaments
       set rebuy_window_open = false
     where id = p_tournament_id and rebuy_window_open = true;
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_rebuy_window(tournament_id, open, expected_version)  [supersedes 0002]
-- ---------------------------------------------------------------------------
-- Flips the rebuy window. Rejected unless rebuys were allowed in Step 1. New in
-- 0003: re-opening (p_open = true) is refused once any paid position has been
-- determined, so the field can't grow after money is locked in. Closing is
-- always allowed; to re-open the director must undo bust-outs until no paid
-- place is filled.
create or replace function set_rebuy_window(
  p_tournament_id uuid,
  p_open boolean,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_allowed boolean;
  v_in_money boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  select rebuys_allowed into v_allowed from tournaments where id = p_tournament_id;
  if not coalesce(v_allowed, false) then
    raise exception 'rebuys_not_allowed' using errcode = 'P0001';
  end if;

  if p_open then
    select exists(
      select 1
        from entries e
        join tournaments t on t.id = e.tournament_id
        join jsonb_array_elements(t.payout_structure) slot
          on (slot->>'position')::int = e.finish_position
       where e.tournament_id = p_tournament_id and e.deleted_at is null
    ) into v_in_money;
    if v_in_money then
      raise exception 'rebuys_locked_after_itm' using errcode = 'P0001';
    end if;
  end if;

  update tournaments
     set rebuy_window_open = p_open, version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
