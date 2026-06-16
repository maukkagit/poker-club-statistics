-- Add the level at which re-entries auto-close. Null = director manages
-- manually (existing behaviour). When set, the live manager auto-calls
-- set_rebuy_window(false) when the clock reaches this level, and auto-reopens
-- if the clock is rewound to before it (unless locked after ITM).
alter table tournaments add column if not exists rebuy_close_level integer;

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating — updated to persist rebuy_close_level
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
