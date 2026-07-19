-- Poker Club Statistics — tournament add-ons.
--
-- Run once in the Supabase SQL editor (or via `supabase db push`) after
-- 0019_tournament_image.sql. Idempotent: safe to re-run.
--
-- An add-on is a one-time purchase of extra chips offered near the end of the
-- rebuy period (often the first break). Unlike a rebuy, ANY player still in
-- the tournament can take one regardless of their chip count.
--
-- Whether add-ons are offered at all (`addons_allowed`) is chosen in the
-- wizard and can also be flipped live from the director console — unlike
-- `rebuys_allowed` it is NOT frozen once play starts (it's a free-standing
-- toggle, like the viewer sound/gradient settings). The only guard: you can't
-- turn add-ons back OFF once at least one player has actually bought one
-- (`entries.addons > 0`), so the field can't retroactively "un-happen".
--
-- Add-ons purchased are tracked as a per-entry headcount (`entries.addons`),
-- mirroring `buy_ins` but kept separate since an add-on isn't a re-entry (the
-- player never busts) and isn't priced into the prize-pool math.

alter table tournaments add column if not exists addons_allowed boolean not null default false;
alter table entries add column if not exists addons integer not null default 0 check (addons >= 0);

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating — extended to persist addons_allowed
-- ---------------------------------------------------------------------------
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
     special, seating, rebuys_allowed, rebuy_window_open, rebuy_close_level,
     addons_allowed,
     version, structure, starting_stack, clock,
     is_pko, bounty_start_amount, bounty_start_level, bounty_chip)
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
     nullif(payload->>'rebuy_close_level', '')::int,
     coalesce((payload->>'addons_allowed')::boolean, false),
     0,
     coalesce(payload->'structure', '[]'::jsonb),
     nullif(payload->>'starting_stack', '')::int,
     jsonb_build_object('started', false, 'running', false, 'elapsed_ms', 0, 'updated_at', null),
     coalesce((payload->>'is_pko')::boolean, false),
     coalesce(nullif(payload->>'bounty_start_amount', '')::numeric, 0),
     nullif(payload->>'bounty_start_level', '')::int,
     coalesce(nullif(payload->>'bounty_chip', '')::numeric, 2.50))
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
-- set_addons_allowed(tournament_id, allowed, expected_version)
-- ---------------------------------------------------------------------------
-- Free-standing toggle (like set_sound_settings / set_title_gradient): can be
-- flipped at any point in an Active tournament's life, not just pre-play.
-- Turning add-ons OFF is rejected once any player has actually bought one.
create or replace function set_addons_allowed(
  p_tournament_id uuid,
  p_allowed boolean,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_has_purchases boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  if not p_allowed then
    select exists(
      select 1 from entries
       where tournament_id = p_tournament_id and deleted_at is null and addons > 0
    ) into v_has_purchases;
    if v_has_purchases then
      raise exception 'addons_locked_has_purchases' using errcode = 'P0001';
    end if;
  end if;

  update tournaments
     set addons_allowed = p_allowed, version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_addon(tournament_id, player_id, expected_version)
-- ---------------------------------------------------------------------------
-- Atomic addons + 1 for a player still in the tournament. Unlike a rebuy,
-- there's no chip-count gate — any alive player may take one while add-ons
-- are allowed for this tournament.
create or replace function record_addon(
  p_tournament_id uuid,
  p_player_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_allowed boolean;
  v_alive boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select addons_allowed into v_allowed from tournaments where id = p_tournament_id;
  if not coalesce(v_allowed, false) then
    raise exception 'addons_not_allowed' using errcode = 'P0001';
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
     set addons = addons + 1
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- restart_tournament — also reset per-entry addon counts [supersedes 0016]
-- ---------------------------------------------------------------------------
-- Identical to 0016's definition, plus `addons` resets to 0 on the kept
-- (original) entrants alongside buy_ins/finish_position/seat.
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

  -- Reset the remaining (original) entrants to a single buy-in, no add-ons,
  -- unseated, with no standings and no per-entry payout override.
  update entries
     set buy_ins = 1,
         addons = 0,
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
  -- keeping all configuration (including addons_allowed). The clock matches
  -- what create_tournament_with_seating seeds (not started); seating (the
  -- draw) and any deal are cleared.
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
