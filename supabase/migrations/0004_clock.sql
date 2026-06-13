-- Poker Club Statistics — tournament clock: blind/break structure, a single
-- counter clock state, and a public read-only share token.
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`) after
-- 0003_add_player.sql. It is idempotent: safe to re-run.
--
-- Design:
--   * `structure` is a jsonb array of rows, each either a blind level
--     ({"kind":"level","sb":..,"bb":..,"ante":..,"duration_min":..}) or a break
--     ({"kind":"break","duration_min":..}). Mirrors how `seating` / payout
--     overrides already live in jsonb.
--   * `clock` is a single-counter state:
--       {"started":bool,"running":bool,"elapsed_ms":number,"updated_at":iso}
--     `elapsed_ms` is the total elapsed across the WHOLE structure as of
--     `updated_at`. While running, the live value is
--     elapsed_ms + (now() - updated_at). The current level / break, time left
--     and "next level" are derived purely from `structure` + this counter, so
--     there is no per-level bookkeeping to keep consistent.
--   * `share_token` is a random public handle for the read-only viewer link.
--   * Every clock mutation is a version-checked RPC, exactly like the other
--     live-tournament actions in 0002_seating.sql.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table tournaments add column if not exists structure      jsonb;
alter table tournaments add column if not exists starting_stack int;
alter table tournaments add column if not exists clock          jsonb;
alter table tournaments add column if not exists share_token    text;

-- Backfill a token for every existing row, then make new rows self-token via a
-- column default. A uuid (hyphens stripped, first 16 hex chars) is plenty of
-- entropy for an unguessable, URL-friendly handle.
update tournaments
   set share_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
 where share_token is null;

alter table tournaments
  alter column share_token set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

create unique index if not exists tournaments_share_token_uniq
  on tournaments (share_token)
  where share_token is not null;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Total structure duration in milliseconds (sum of every row's duration_min).
-- Used to clamp the counter so fast-forward can't run past the end.
create or replace function _structure_total_ms(p_tournament_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum((r->>'duration_min')::numeric), 0) * 60000
    from tournaments t
    cross join lateral jsonb_array_elements(coalesce(t.structure, '[]'::jsonb)) r
   where t.id = p_tournament_id;
$$;

-- The live elapsed_ms for a clock jsonb as of now(): the stored counter plus,
-- when running, the wall-clock time since it was last stamped.
create or replace function _clock_effective_ms(p_clock jsonb)
returns numeric
language sql
stable
as $$
  select case
    when coalesce((p_clock->>'running')::boolean, false)
         and nullif(p_clock->>'updated_at', '') is not null
    then coalesce((p_clock->>'elapsed_ms')::numeric, 0)
         + extract(epoch from (now() - (p_clock->>'updated_at')::timestamptz)) * 1000
    else coalesce((p_clock->>'elapsed_ms')::numeric, 0)
  end;
$$;

-- ---------------------------------------------------------------------------
-- start_clock(tournament_id, expected_version)
-- ---------------------------------------------------------------------------
-- Begin (or restart) the clock from zero, running. The clock is never started
-- automatically at creation — the director presses Start.
create or replace function start_clock(
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
  update tournaments
     set clock = jsonb_build_object(
           'started', true,
           'running', true,
           'elapsed_ms', 0,
           'updated_at', to_jsonb(now())
         ),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_clock_running(tournament_id, running, expected_version)
-- ---------------------------------------------------------------------------
-- Pause (running=false) or resume (running=true). Folds the elapsed time
-- accrued since the last stamp into elapsed_ms, then re-stamps. Idempotent and
-- safe even if the clock was never explicitly started (treated as a start).
create or replace function set_clock_running(
  p_tournament_id uuid,
  p_running boolean,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_clock jsonb;
  v_eff numeric;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  select clock into v_clock from tournaments where id = p_tournament_id;
  v_eff := _clock_effective_ms(v_clock);
  update tournaments
     set clock = jsonb_build_object(
           'started', true,
           'running', p_running,
           'elapsed_ms', round(v_eff),
           'updated_at', to_jsonb(now())
         ),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- adjust_clock(tournament_id, delta_ms, expected_version)
-- ---------------------------------------------------------------------------
-- Rewind (negative delta) or fast-forward (positive delta) by delta_ms,
-- preserving the running flag. Clamped to [0, total structure duration].
create or replace function adjust_clock(
  p_tournament_id uuid,
  p_delta_ms numeric,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_clock jsonb;
  v_eff numeric;
  v_total numeric;
  v_running boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  select clock into v_clock from tournaments where id = p_tournament_id;
  v_running := coalesce((v_clock->>'running')::boolean, false);
  v_eff := _clock_effective_ms(v_clock) + p_delta_ms;
  v_total := _structure_total_ms(p_tournament_id);
  v_eff := greatest(0, v_eff);
  if v_total > 0 then
    v_eff := least(v_eff, v_total);
  end if;
  update tournaments
     set clock = jsonb_build_object(
           'started', true,
           'running', v_running,
           'elapsed_ms', round(v_eff),
           'updated_at', to_jsonb(now())
         ),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating(payload) — extended for the clock
-- ---------------------------------------------------------------------------
-- Same as 0002 but also persists the blind/break `structure` and
-- `starting_stack` chosen in the wizard's Structure step, and seeds a
-- not-started clock. `share_token` is filled by the column default.
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
     special, seating, rebuys_allowed, rebuy_window_open, version,
     structure, starting_stack, clock)
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
     0,
     coalesce(payload->'structure', '[]'::jsonb),
     nullif(payload->>'starting_stack', '')::int,
     jsonb_build_object('started', false, 'running', false, 'elapsed_ms', 0, 'updated_at', null))
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
