-- Poker Club Statistics — auto-pause the tournament clock when the winner is
-- decided (issue #21 follow-up).
--
-- Run once in the Supabase SQL editor after 0004_clock.sql. Idempotent.
--
-- When the second-to-last player busts, record_bust crowns the lone survivor
-- 1st place. Play is over at that instant, so the clock should stop on its own
-- rather than keep ticking on the projector. We fold the live elapsed time into
-- the counter and flip `running` to false (only when the clock was actually
-- running). finish_tournament's lone-survivor safety net does the same, and a
-- finished tournament always ends with a stopped clock.
--
-- These are verbatim copies of the 0002 functions with the auto-pause added;
-- everything else is unchanged.

-- ---------------------------------------------------------------------------
-- record_bust — now auto-pauses the clock when it crowns the winner
-- ---------------------------------------------------------------------------
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

  -- Down to one — crown the survivor 1st place and stop the clock.
  if v_alive - 1 = 1 then
    select player_id into v_winner
      from entries
     where tournament_id = p_tournament_id and finish_position is null and deleted_at is null;
    if v_winner is not null then
      update entries set finish_position = 1, table_no = null, seat_no = null
       where tournament_id = p_tournament_id and player_id = v_winner and deleted_at is null;
    end if;

    -- Winner decided: auto-pause a running clock (fold elapsed, stop ticking).
    update tournaments
       set clock = jsonb_build_object(
             'started', true,
             'running', false,
             'elapsed_ms', round(_clock_effective_ms(clock)),
             'updated_at', to_jsonb(now())
           )
     where id = p_tournament_id
       and coalesce((clock->>'started')::boolean, false)
       and coalesce((clock->>'running')::boolean, false);
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_tournament — stop the clock when the tournament ends
-- ---------------------------------------------------------------------------
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
  v_overrides jsonb;
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

  -- Bake the deal into the finishing players' overrides, then clear it.
  select payout_overrides into v_overrides from tournaments where id = p_tournament_id;
  if v_overrides is not null and jsonb_typeof(v_overrides) = 'object' then
    update entries e
       set payout_override = (v_overrides->>(e.finish_position::text))::numeric
     where e.tournament_id = p_tournament_id
       and e.finish_position is not null
       and v_overrides ? (e.finish_position::text)
       and e.deleted_at is null;
    update tournaments set payout_overrides = null where id = p_tournament_id;
  end if;

  delete from tournament_undo where tournament_id = p_tournament_id;

  -- Stop a running clock as the tournament closes (fold elapsed, stop ticking).
  update tournaments
     set clock = jsonb_build_object(
           'started', true,
           'running', false,
           'elapsed_ms', round(_clock_effective_ms(clock)),
           'updated_at', to_jsonb(now())
         )
   where id = p_tournament_id
     and coalesce((clock->>'started')::boolean, false)
     and coalesce((clock->>'running')::boolean, false);

  update tournaments
     set state = 'Finished', version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
