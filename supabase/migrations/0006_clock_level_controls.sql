-- Poker Club Statistics — live clock: absolute seek + structure editing
-- (issue #21 follow-up).
--
-- Run once in the Supabase SQL editor after 0005_clock_autopause.sql. Idempotent.
--
-- Adds two version-checked RPCs used by the live director console:
--   * set_clock_elapsed — move the counter to an absolute position and set the
--     running flag. Powers "Restart level" and "Fast-forward to end of level"
--     (both pass the level boundary computed client-side and running=false so
--     the clock pauses on the jump).
--   * set_structure — replace the blind/break ladder (and starting stack) of a
--     live tournament. The counter is left untouched; the current level is
--     re-derived from the new structure.

-- ---------------------------------------------------------------------------
-- set_clock_elapsed(tournament_id, elapsed_ms, running, expected_version)
-- ---------------------------------------------------------------------------
create or replace function set_clock_elapsed(
  p_tournament_id uuid,
  p_elapsed_ms numeric,
  p_running boolean,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_total numeric;
  v_eff numeric;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  v_total := _structure_total_ms(p_tournament_id);
  v_eff := greatest(0, coalesce(p_elapsed_ms, 0));
  if v_total > 0 then
    v_eff := least(v_eff, v_total);
  end if;
  update tournaments
     set clock = jsonb_build_object(
           'started', true,
           'running', coalesce(p_running, false),
           'elapsed_ms', round(v_eff),
           'updated_at', to_jsonb(now())
         ),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_structure(tournament_id, structure, starting_stack, expected_version)
-- ---------------------------------------------------------------------------
create or replace function set_structure(
  p_tournament_id uuid,
  p_structure jsonb,
  p_starting_stack int,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);
  if p_structure is null or jsonb_typeof(p_structure) <> 'array' or jsonb_array_length(p_structure) = 0 then
    raise exception 'structure cannot be empty' using errcode = 'P0001';
  end if;
  update tournaments
     set structure = p_structure,
         starting_stack = p_starting_stack,
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
