-- Poker Club Statistics — configurable add-on price / chip grant.
--
-- Run once in the Supabase SQL editor after 0020_addons.sql. Idempotent: safe
-- to re-run.
--
-- Extends the add-on toggle from 0020 with two configurable numbers:
--   - `addon_price`: EUR cost of one add-on. Contributes to the REGULAR prize
--     pool only (like a rebuy's `buy_in_amount`) — an add-on never grants a
--     fresh PKO bounty, matching how add-ons work at the table.
--   - `addon_chips`: chips granted per add-on. Counted into "chips in play" /
--     "average stack" alongside the starting-stack chips from buy-ins.
--
-- Both default sensibly at creation time when the wizard doesn't supply them:
-- price defaults to the full entry price (buy-in + bounty, i.e. "the same as
-- the buy-in"), chips default to the starting stack. They stay director-
-- editable afterwards from the live manager's Settings → Format & players tab
-- via `set_addon_config` — a free-standing RPC, NOT frozen once play starts —
-- until the FIRST add-on is actually bought, at which point the whole add-on
-- configuration (allowed/price/chips) locks so a purchase already made can't
-- retroactively become inconsistent with the numbers.

alter table tournaments add column if not exists addon_price numeric not null default 0;
alter table tournaments add column if not exists addon_chips integer not null default 0;

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating — default addon_price / addon_chips
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
     addons_allowed, addon_price, addon_chips,
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
     -- Default price = the full entry price (buy-in + bounty, if PKO) — "the
     -- same as the buy-in" from the player's point of view.
     coalesce(
       nullif(payload->>'addon_price', '')::numeric,
       (payload->>'buy_in_amount')::numeric + coalesce(nullif(payload->>'bounty_start_amount', '')::numeric, 0)
     ),
     -- Default chip grant = the starting stack (a fresh second stack).
     coalesce(nullif(payload->>'addon_chips', '')::int, nullif(payload->>'starting_stack', '')::int, 0),
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
-- set_addon_config(tournament_id, allowed, price, chips, expected_version)
-- ---------------------------------------------------------------------------
-- Supersedes 0020's `set_addons_allowed`: same free-standing (not frozen by
-- play-started) toggle, now bundled with the price/chip-grant config so all
-- three change atomically. Any change is rejected once a purchase exists,
-- unless it's a genuine no-op (every value matches what's already stored) —
-- keeps already-collected money/chips consistent with the configured numbers.
drop function if exists set_addons_allowed(uuid, boolean, int);
create or replace function set_addon_config(
  p_tournament_id uuid,
  p_allowed boolean,
  p_price numeric,
  p_chips int,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_allowed boolean;
  v_price numeric;
  v_chips int;
  v_has_purchases boolean;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select addons_allowed, addon_price, addon_chips
    into v_allowed, v_price, v_chips
    from tournaments where id = p_tournament_id;

  select exists(
    select 1 from entries
     where tournament_id = p_tournament_id and deleted_at is null and addons > 0
  ) into v_has_purchases;

  if v_has_purchases and (
    p_allowed is distinct from v_allowed
    or p_price is distinct from v_price
    or p_chips is distinct from v_chips
  ) then
    raise exception 'addons_locked_has_purchases' using errcode = 'P0001';
  end if;

  update tournaments
     set addons_allowed = p_allowed,
         addon_price = coalesce(p_price, 0),
         addon_chips = coalesce(p_chips, 0),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
