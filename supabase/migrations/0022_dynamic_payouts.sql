-- Poker Club Statistics — dynamic (entry-scaled) payouts.
--
-- Run once in the Supabase SQL editor after 0021_addon_config.sql.
-- Idempotent: safe to re-run.
--
-- Normally `payout_structure` is a fixed % split chosen at setup. With DYNAMIC
-- payouts the director instead configures a ladder of TIERS keyed by the total
-- entry count (starting players + rebuys + late entries = sum of buy_ins). The
-- more entries, the more places paid, per the tier that applies.
--
--   payout_tiers = [
--     { "min_entries": 24, "pcts": [50, 30, 20] },
--     { "min_entries": 32, "pcts": [47, 27, 16, 10] },
--     ...
--   ]
--
-- The applicable tier is the one with the greatest `min_entries` that is <= the
-- current entry count; below the lowest threshold we fall back to the lowest
-- tier (its split is the floor). Each tier's `pcts` sum to 100 and imply
-- positions 1..N.
--
-- To keep every existing reader (SQL ITM checks, computeEntries, the podium,
-- the public clock) working unchanged, we MATERIALIZE the resolved split back
-- into `payout_structure` whenever the entry count changes — via a trigger on
-- `entries`. So `payout_structure` stays the single source of truth; dynamic
-- payouts just keeps it in sync with the field size automatically.

alter table tournaments add column if not exists dynamic_payouts boolean not null default false;
alter table tournaments add column if not exists payout_tiers jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- _assert_payout_tiers(tiers jsonb)
-- ---------------------------------------------------------------------------
-- Validate a dynamic-payout tier ladder: non-empty, each tier has a positive
-- integer `min_entries` and a non-empty `pcts` array summing to 100 (±0.01).
create or replace function _assert_payout_tiers(tiers jsonb)
returns void
language plpgsql
as $$
declare
  v_tier jsonb;
  v_sum numeric;
  v_len int;
begin
  if tiers is null or jsonb_typeof(tiers) <> 'array' or jsonb_array_length(tiers) = 0 then
    raise exception 'payout_tiers cannot be empty' using errcode = 'P0001';
  end if;

  for v_tier in select * from jsonb_array_elements(tiers) loop
    if (v_tier->>'min_entries') is null or (v_tier->>'min_entries')::int < 1 then
      raise exception 'payout_tiers min_entries must be a positive integer' using errcode = 'P0001';
    end if;
    if v_tier->'pcts' is null or jsonb_typeof(v_tier->'pcts') <> 'array' then
      raise exception 'payout_tiers pcts must be an array' using errcode = 'P0001';
    end if;
    select count(*), coalesce(sum(value::numeric), 0)
      into v_len, v_sum
      from jsonb_array_elements_text(v_tier->'pcts');
    if v_len = 0 then
      raise exception 'payout_tiers pcts cannot be empty' using errcode = 'P0001';
    end if;
    if abs(v_sum - 100) > 0.01 then
      raise exception 'payout_tiers pcts must sum to 100, got %', v_sum using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_dynamic_payout(tournament_id) — materialize the resolved split
-- ---------------------------------------------------------------------------
-- No-op unless the tournament has dynamic payouts and a non-empty tier ladder.
-- Picks the applicable tier for the current entry count (sum of buy_ins over
-- live entries) and writes the corresponding position/pct rows into
-- `payout_structure`. Does NOT bump `version` — it piggybacks on whatever RPC
-- changed the entries (which bumps version and triggers the client refetch).
create or replace function apply_dynamic_payout(p_tournament_id uuid)
returns void
language plpgsql
as $$
declare
  v_dynamic boolean;
  v_tiers jsonb;
  v_total int;
  v_tier jsonb;
  v_structure jsonb;
begin
  select dynamic_payouts, payout_tiers
    into v_dynamic, v_tiers
    from tournaments where id = p_tournament_id;

  if not coalesce(v_dynamic, false) then return; end if;
  if v_tiers is null or jsonb_array_length(v_tiers) = 0 then return; end if;

  select coalesce(sum(buy_ins), 0)::int into v_total
    from entries
   where tournament_id = p_tournament_id and deleted_at is null;

  -- Greatest tier whose threshold is at or below the field size...
  select tier into v_tier
    from jsonb_array_elements(v_tiers) tier
   where (tier->>'min_entries')::int <= v_total
   order by (tier->>'min_entries')::int desc
   limit 1;
  -- ...else the lowest tier (its split is the floor for tiny fields).
  if v_tier is null then
    select tier into v_tier
      from jsonb_array_elements(v_tiers) tier
     order by (tier->>'min_entries')::int asc
     limit 1;
  end if;

  select jsonb_agg(jsonb_build_object('position', ord, 'pct', pct) order by ord)
    into v_structure
    from (
      select row_number() over () as ord, value::numeric as pct
        from jsonb_array_elements_text(v_tier->'pcts')
    ) s;

  update tournaments
     set payout_structure = coalesce(v_structure, payout_structure)
   where id = p_tournament_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: re-materialize whenever the entry count could have changed.
-- ---------------------------------------------------------------------------
create or replace function _recompute_dynamic_payout()
returns trigger
language plpgsql
as $$
begin
  perform apply_dynamic_payout(coalesce(new.tournament_id, old.tournament_id));
  return null;
end;
$$;

drop trigger if exists trg_dynamic_payout_ins on entries;
create trigger trg_dynamic_payout_ins
  after insert or delete on entries
  for each row execute function _recompute_dynamic_payout();

-- Only fire on updates that can change the live entry count (a re-entry bumps
-- buy_ins; a soft-delete/undo flips deleted_at). Seat/finish updates are
-- ignored so rebalancing and bustouts don't thrash the structure.
drop trigger if exists trg_dynamic_payout_upd on entries;
create trigger trg_dynamic_payout_upd
  after update of buy_ins, deleted_at on entries
  for each row execute function _recompute_dynamic_payout();

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating — persist dynamic_payouts + payout_tiers
-- [supersedes 0021, which added the add-on columns folded back in here]
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
  v_dynamic boolean := coalesce((payload->>'dynamic_payouts')::boolean, false);
  v_tiers jsonb := coalesce(payload->'payout_tiers', '[]'::jsonb);
begin
  perform _assert_payout_sums_100(payload->'payout_structure');
  if v_dynamic then
    perform _assert_payout_tiers(v_tiers);
  end if;

  if payload->>'location_id' is null or btrim(payload->>'location_id') = '' then
    raise exception 'location_id is required' using errcode = 'P0001';
  end if;

  insert into tournaments
    (date, name, buy_in_amount, payout_structure, notes, location_id, state,
     special, seating, rebuys_allowed, rebuy_window_open, rebuy_close_level,
     addons_allowed, addon_price, addon_chips,
     dynamic_payouts, payout_tiers,
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
     -- Default price = the full entry price (buy-in + bounty, if PKO).
     coalesce(
       nullif(payload->>'addon_price', '')::numeric,
       (payload->>'buy_in_amount')::numeric + coalesce(nullif(payload->>'bounty_start_amount', '')::numeric, 0)
     ),
     -- Default chip grant = the starting stack (a fresh second stack).
     coalesce(nullif(payload->>'addon_chips', '')::int, nullif(payload->>'starting_stack', '')::int, 0),
     v_dynamic,
     v_tiers,
     0,
     coalesce(payload->'structure', '[]'::jsonb),
     nullif(payload->>'starting_stack', '')::int,
     jsonb_build_object('started', false, 'running', false, 'elapsed_ms', 0, 'updated_at', null),
     coalesce((payload->>'is_pko')::boolean, false),
     coalesce(nullif(payload->>'bounty_start_amount', '')::numeric, 0),
     nullif(payload->>'bounty_start_level', '')::int,
     coalesce(nullif(payload->>'bounty_chip', '')::numeric, 2.50))
  returning id into v_id;

  -- One entry per player; default a single buy-in (the seated stack). The
  -- entries trigger materializes the dynamic split from the starting count.
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
-- set_payout_tiers(tournament_id, dynamic, tiers, expected_version)
-- ---------------------------------------------------------------------------
-- Free-standing director control for dynamic payouts: flip the mode and/or
-- edit the tier ladder live. Rejected once a paid-out position is CONFIRMED
-- (some finisher holds a position the current structure pays) — the director
-- must undo bustouts past the bubble first, mirroring the rebuy ITM lock.
-- Turning dynamic OFF keeps the last materialized `payout_structure` as the
-- now-static split; turning it ON (or editing tiers) re-materializes at once.
create or replace function set_payout_tiers(
  p_tournament_id uuid,
  p_dynamic boolean,
  p_tiers jsonb,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_in_money boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      join jsonb_array_elements(t.payout_structure) slot
        on (slot->>'position')::int = e.finish_position
     where e.tournament_id = p_tournament_id
       and e.deleted_at is null
       and e.finish_position is not null
  ) into v_in_money;
  if v_in_money then
    raise exception 'payouts_locked_after_itm' using errcode = 'P0001';
  end if;

  if p_dynamic then
    perform _assert_payout_tiers(p_tiers);
  end if;

  update tournaments
     set dynamic_payouts = coalesce(p_dynamic, false),
         payout_tiers = coalesce(p_tiers, '[]'::jsonb),
         version = v_version + 1
   where id = p_tournament_id;

  -- Re-materialize immediately so the structure reflects the new config
  -- without waiting for the next entry change.
  perform apply_dynamic_payout(p_tournament_id);

  return v_version + 1;
end;
$$;
