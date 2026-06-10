-- Poker Club Statistics — live tournaments: seating, rebuys, rebalancing
-- (issue #20).
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`) after
-- 0001_init.sql. It is idempotent: safe to re-run.
--
-- Design goals:
--   * Make invalid states impossible at the DB level (CHECKs + a partial unique
--     index on seats).
--   * Make every compound change atomic and version-checked via RPCs, so a
--     stale client can never half-write or clobber a concurrent edit.
--   * Keep the tricky combinatorics (the draw / rebalance maths) in the pure,
--     unit-tested `lib/seating.ts`; these functions only persist results and
--     re-validate the invariants.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

-- entries: per-player seat + optional performance bucket.
alter table entries add column if not exists table_no smallint;
alter table entries add column if not exists seat_no  smallint;
alter table entries add column if not exists bucket   smallint;

-- Both seat coordinates are null (not seated / busted) or both set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entries_seat_both_or_neither'
  ) then
    alter table entries
      add constraint entries_seat_both_or_neither
      check ((table_no is null) = (seat_no is null));
  end if;
end$$;

-- A live seat is unique per tournament. Partial so multiple null/"unseated"
-- and soft-deleted rows don't collide.
create unique index if not exists entries_seat_uniq
  on entries (tournament_id, table_no, seat_no)
  where seat_no is not null and deleted_at is null;

-- tournaments: live-management columns.
alter table tournaments add column if not exists seating jsonb;
alter table tournaments add column if not exists rebuys_allowed   boolean not null default true;
alter table tournaments add column if not exists rebuy_window_open boolean not null default true;
alter table tournaments add column if not exists version int not null default 0;
-- "Make a deal" payout overrides: a jsonb map of finishing position (as a
-- string key) -> euro amount, e.g. {"1": 300, "2": 150}. When present it
-- overrides the percentage split for that position; a per-entry
-- payout_override still wins over it. Null/absent until a deal is struck.
alter table tournaments add column if not exists payout_overrides jsonb;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Optimistic-concurrency guard. Raises a 'version_conflict' (SQLSTATE 'P0001')
-- the API maps to HTTP 409 when the caller's expected version is stale.
create or replace function _assert_version(p_tournament_id uuid, p_expected int)
returns int
language plpgsql
as $$
declare
  v_current int;
  v_deleted timestamptz;
begin
  select version, deleted_at into v_current, v_deleted
    from tournaments where id = p_tournament_id
    for update;
  if v_current is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if v_deleted is not null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if p_expected is not null and p_expected <> v_current then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  return v_current;
end;
$$;

-- Renumber a table's occupants to a gapless 1..N ring, preserving current
-- order. Called after any seat removal/move so seat_no never has a hole.
create or replace function _reindex_table(p_tournament_id uuid, p_table_no smallint)
returns void
language plpgsql
as $$
begin
  if p_table_no is null then return; end if;
  with ordered as (
    select id, row_number() over (order by seat_no) as rn
      from entries
     where tournament_id = p_tournament_id
       and table_no = p_table_no
       and seat_no is not null
       and deleted_at is null
  )
  update entries e
     set seat_no = o.rn
    from ordered o
   where e.id = o.id
     and e.seat_no is distinct from o.rn::smallint;
end;
$$;

-- Validate that a payout_structure jsonb array sums to 100.
create or replace function _assert_payout_sums_100(p_payout jsonb)
returns void
language plpgsql
as $$
declare
  v_sum numeric;
begin
  if p_payout is null or jsonb_typeof(p_payout) <> 'array' or jsonb_array_length(p_payout) = 0 then
    raise exception 'payout_structure cannot be empty' using errcode = 'P0001';
  end if;
  select coalesce(sum((e->>'pct')::numeric), 0) into v_sum
    from jsonb_array_elements(p_payout) e;
  if abs(v_sum - 100) > 0.01 then
    raise exception 'payout_structure must sum to 100, got %', v_sum using errcode = 'P0001';
  end if;
end;
$$;

-- Write a set of seat assignments for a tournament: clear every current seat,
-- then apply [{player_id, table_no, seat_no}, ...]. Shared by the initial draw,
-- draw-later, re-draw and break/move flows.
create or replace function _apply_assignments(p_tournament_id uuid, p_assignments jsonb)
returns void
language plpgsql
as $$
begin
  update entries
     set table_no = null, seat_no = null
   where tournament_id = p_tournament_id and deleted_at is null;

  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    return;
  end if;

  update entries e
     set table_no = (a->>'table_no')::smallint,
         seat_no  = (a->>'seat_no')::smallint
    from jsonb_array_elements(p_assignments) a
   where e.tournament_id = p_tournament_id
     and e.player_id = (a->>'player_id')::uuid
     and e.deleted_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating(payload, expected_version?)
-- ---------------------------------------------------------------------------
-- Creates an Active tournament + its entries (+ optional seating) in one tx.
-- Validates payout sums to 100 and records rebuys_allowed. Returns the new id.
--
-- payload shape:
-- {
--   "date": "2026-06-10", "name": "", "buy_in_amount": 30,
--   "payout_structure": [{"position":1,"pct":60}, ...],
--   "notes": "", "location_id": "<uuid>", "special": false,
--   "rebuys_allowed": true,
--   "entries": [{"player_id":"<uuid>", "bucket": 1|null}, ...],
--   "seating": { ... } | null,
--   "assignments": [{"player_id","table_no","seat_no"}, ...] | null
-- }
create or replace function create_tournament_with_seating(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_entries jsonb := coalesce(payload->'entries', '[]'::jsonb);
  v_assignments jsonb := payload->'assignments';
  v_seating jsonb := payload->'seating';
begin
  perform _assert_payout_sums_100(payload->'payout_structure');

  if payload->>'location_id' is null or btrim(payload->>'location_id') = '' then
    raise exception 'location_id is required' using errcode = 'P0001';
  end if;

  insert into tournaments
    (date, name, buy_in_amount, payout_structure, notes, location_id, state,
     special, seating, rebuys_allowed, rebuy_window_open, version)
  values
    ((payload->>'date')::date,
     coalesce(payload->>'name', ''),
     (payload->>'buy_in_amount')::numeric,
     payload->'payout_structure',
     coalesce(payload->>'notes', ''),
     (payload->>'location_id')::uuid,
     'Active',
     coalesce((payload->>'special')::boolean, false),
     v_seating,
     coalesce((payload->>'rebuys_allowed')::boolean, true),
     true,
     0)
  returning id into v_id;

  -- One entry per player; default a single buy-in (the seated stack).
  insert into entries (tournament_id, player_id, buy_ins, bucket)
  select v_id,
         (e->>'player_id')::uuid,
         1,
         nullif(e->>'bucket', '')::smallint
    from jsonb_array_elements(v_entries) e;

  if v_assignments is not null then
    perform _apply_assignments(v_id, v_assignments);
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- assign_seats(tournament_id, seating, assignments, expected_version)
-- ---------------------------------------------------------------------------
-- Draw-later AND re-draw: clears existing seats and writes the new assignment
-- atomically, storing the seating jsonb. Bumps version.
create or replace function assign_seats(
  p_tournament_id uuid,
  p_seating jsonb,
  p_assignments jsonb,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  perform _apply_assignments(p_tournament_id, p_assignments);
  update tournaments
     set seating = p_seating, version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_rebuy_window(tournament_id, open, expected_version)
-- ---------------------------------------------------------------------------
-- Flips the rebuy window. Rejected unless rebuys were allowed in Step 1.
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
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  select rebuys_allowed into v_allowed from tournaments where id = p_tournament_id;
  if not coalesce(v_allowed, false) then
    raise exception 'rebuys_not_allowed' using errcode = 'P0001';
  end if;
  update tournaments
     set rebuy_window_open = p_open, version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_buyin(tournament_id, player_id, expected_version)
-- ---------------------------------------------------------------------------
-- Atomic buy_ins + 1. Rejected unless rebuys are ACTIVE (allowed AND window
-- open), so a stale client can't sneak one in after the window closes.
create or replace function record_buyin(
  p_tournament_id uuid,
  p_player_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_active boolean;
  v_alive boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select (rebuys_allowed and rebuy_window_open) into v_active
    from tournaments where id = p_tournament_id;
  if not coalesce(v_active, false) then
    raise exception 'rebuys_not_active' using errcode = 'P0001';
  end if;

  select (finish_position is null) into v_alive
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;
  if v_alive is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if not v_alive then
    raise exception 'player_already_busted' using errcode = 'P0001';
  end if;

  update entries
     set buy_ins = buy_ins + 1
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_bust(tournament_id, player_id, expected_version)
-- ---------------------------------------------------------------------------
-- Sets finish_position to the current alive count, clears the seat and
-- re-indexes the vacated table. Busts fill places from the bottom up
-- (Nth, then N-1th, ...); the sole survivor is left alive (finish_position
-- null) and is only crowned 1st place by finish_tournament. Keeping the
-- champion unassigned during play is what lets undo_bust stay reversible.
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
  v_table smallint;
  v_already boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select (finish_position is not null), table_no
    into v_already, v_table
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;
  if v_already is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_already then
    raise exception 'player_already_busted' using errcode = 'P0001';
  end if;

  -- Alive count *including* the busting player == their finishing place.
  select count(*) into v_alive
    from entries
   where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;

  update entries
     set finish_position = v_alive, table_no = null, seat_no = null
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  perform _reindex_table(p_tournament_id, v_table);

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- undo_bust(tournament_id, player_id, expected_version)
-- ---------------------------------------------------------------------------
-- Reverse a mistaken bust: the player returns to the field (alive, unseated)
-- and every player who busted *after* them (a smaller finishing place) is
-- bumped up one place, so the standings stay a gapless block from the top.
create or replace function undo_bust(
  p_tournament_id uuid,
  p_player_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_place int;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select finish_position into v_place
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;
  if v_place is null then
    raise exception 'player_not_busted' using errcode = 'P0001';
  end if;

  -- Bump everyone who finished below this place (busted later) up by one.
  update entries
     set finish_position = finish_position + 1
   where tournament_id = p_tournament_id
     and finish_position is not null and finish_position < v_place
     and deleted_at is null;

  -- The un-busted player is alive again but unseated (their seat was cleared
  -- on bust); draw/move them back if the tournament is seated.
  update entries
     set finish_position = null, table_no = null, seat_no = null
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_deal(tournament_id, overrides, expected_version)
-- ---------------------------------------------------------------------------
-- Record (or clear, with null) a "deal": a jsonb map of finishing position ->
-- euro amount that overrides the percentage split. Validated server-side to
-- sum exactly to the current prize pool so a stale client can't persist a
-- distribution that doesn't add up.
create or replace function set_deal(
  p_tournament_id uuid,
  p_overrides jsonb,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_pool numeric;
  v_sum numeric;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  if p_overrides is not null and jsonb_typeof(p_overrides) = 'object'
     and (select count(*) from jsonb_object_keys(p_overrides)) > 0 then
    select coalesce(sum(e.buy_ins), 0) * t.buy_in_amount into v_pool
      from tournaments t
      left join entries e on e.tournament_id = t.id and e.deleted_at is null
     where t.id = p_tournament_id
     group by t.buy_in_amount;

    select coalesce(sum(value::numeric), 0) into v_sum
      from jsonb_each_text(p_overrides);

    if abs(coalesce(v_sum, 0) - coalesce(v_pool, 0)) > 0.01 then
      raise exception 'deal_must_sum_to_pool: got %, pool %', v_sum, v_pool using errcode = 'P0001';
    end if;
  end if;

  update tournaments
     set payout_overrides = p_overrides, version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- rebalance_move(tournament_id, player_id, to_table, button_seat?, version)
-- ---------------------------------------------------------------------------
-- Move one player to the tail of another table's ring, re-index the table they
-- left, and optionally pin the losing table's button seat in the seating jsonb.
create or replace function rebalance_move(
  p_tournament_id uuid,
  p_player_id uuid,
  p_to_table smallint,
  p_from_button_seat smallint,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_from_table smallint;
  v_next_seat smallint;
  v_seating jsonb;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select table_no into v_from_table
    from entries
   where tournament_id = p_tournament_id and player_id = p_player_id
     and seat_no is not null and deleted_at is null;
  if v_from_table is null then
    raise exception 'player_not_seated' using errcode = 'P0001';
  end if;

  select coalesce(max(seat_no), 0) + 1 into v_next_seat
    from entries
   where tournament_id = p_tournament_id and table_no = p_to_table
     and seat_no is not null and deleted_at is null;

  update entries
     set table_no = p_to_table, seat_no = v_next_seat
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  perform _reindex_table(p_tournament_id, v_from_table);

  -- Pin the real button on the losing table if the caller resolved it.
  if p_from_button_seat is not null then
    select seating into v_seating from tournaments where id = p_tournament_id;
    if v_seating is not null then
      v_seating := jsonb_set(
        v_seating,
        array['buttons', v_from_table::text],
        to_jsonb(p_from_button_seat),
        true
      );
      update tournaments set seating = v_seating where id = p_tournament_id;
    end if;
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- break_table(tournament_id, break_table, assignments, version)
-- ---------------------------------------------------------------------------
-- Redistribute a table's players. `assignments` is the new placement for the
-- moved players ([{player_id,table_no,seat_no}, ...], computed by the pure
-- module); the broken table ends empty. Re-indexes affected tables.
create or replace function break_table(
  p_tournament_id uuid,
  p_break_table smallint,
  p_assignments jsonb,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_tbl smallint;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Clear the broken table.
  update entries set table_no = null, seat_no = null
   where tournament_id = p_tournament_id and table_no = p_break_table and deleted_at is null;

  -- Apply the moved players' new seats.
  if p_assignments is not null and jsonb_typeof(p_assignments) = 'array' then
    update entries e
       set table_no = (a->>'table_no')::smallint,
           seat_no  = (a->>'seat_no')::smallint
      from jsonb_array_elements(p_assignments) a
     where e.tournament_id = p_tournament_id
       and e.player_id = (a->>'player_id')::uuid
       and e.deleted_at is null;

    -- Re-index every table that received players.
    for v_tbl in
      select distinct (a->>'table_no')::smallint
        from jsonb_array_elements(p_assignments) a
    loop
      perform _reindex_table(p_tournament_id, v_tbl);
    end loop;
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_tournament(tournament_id, expected_version)
-- ---------------------------------------------------------------------------
-- Transition to Finished (payouts were set in Step 1). If exactly one player
-- is still alive they are crowned 1st place (the champion is only assigned
-- here, never mid-play, so undo_bust stays reversible). Bumps version.
create or replace function finish_tournament(
  p_tournament_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_alive int;
  v_winner uuid;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select count(*) into v_alive
    from entries
   where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;

  if v_alive = 1 then
    select player_id into v_winner
      from entries
     where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;
    update entries set finish_position = 1, table_no = null, seat_no = null
     where tournament_id = p_tournament_id and player_id = v_winner and deleted_at is null;
  end if;

  update tournaments
     set state = 'Finished', version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
