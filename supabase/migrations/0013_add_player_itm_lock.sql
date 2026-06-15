-- Poker Club Statistics — lock late entries once the money is in sight.
--
-- Run once in the Supabase SQL editor after 0012_clock_sounds.sql. Idempotent.
--
-- Adding a player is already gated on the rebuy window being open. This also
-- refuses a late entry once any paid position has been determined (a finisher
-- holds a position the payout structure pays), even if the director hasn't
-- closed the window yet — the field can't grow after the money bubble bursts.
-- Mirrors the in-the-money guard in set_rebuy_window.

-- ---------------------------------------------------------------------------
-- add_player — rebuy-window gate + in-the-money lock [supersedes 0010]
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
  v_in_money boolean;
  v_exists boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Late entries are only possible while rebuys are open — same gate as a rebuy.
  select (rebuys_allowed and rebuy_window_open) into v_active
    from tournaments where id = p_tournament_id;
  if not coalesce(v_active, false) then
    raise exception 'rebuys_not_active' using errcode = 'P0001';
  end if;

  -- ...and never once a paid position has been determined.
  select exists(
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      join jsonb_array_elements(t.payout_structure) slot
        on (slot->>'position')::int = e.finish_position
     where e.tournament_id = p_tournament_id and e.deleted_at is null
  ) into v_in_money;
  if v_in_money then
    raise exception 'add_locked_after_itm' using errcode = 'P0001';
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
