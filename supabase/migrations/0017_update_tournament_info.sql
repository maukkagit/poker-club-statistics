-- Poker Club Statistics — edit a live tournament's setup from the live manager.
--
-- Run once in the Supabase SQL editor after 0016_restart_tournament.sql. Idempotent.
--
-- A single, version-checked RPC that patches the tournament's setup fields (the
-- data captured by the "Start a tournament" wizard's Info step) and, optionally,
-- the player roster. Only the keys present in `p_patch` are touched.
--
-- Once play has started, the tournament's money/format/field is fixed: the RPC
-- accepts ONLY the "basic" metadata keys (date, name, notes, location_id,
-- special) and rejects everything else with 'play_already_started'. Play counts
-- as started once the clock has been started OR anyone has busted — including a
-- bust that was immediately rebought (a re-entry bumps buy_ins above 1). The
-- live manager mirrors this by locking those inputs and pointing the director at
-- "Restart tournament" instead. Blind structure, starting stack and the seat
-- draw are edited through their own dedicated live controls, not here.

-- ---------------------------------------------------------------------------
-- update_tournament_info(tournament_id, patch, expected_version)
-- ---------------------------------------------------------------------------
create or replace function update_tournament_info(
  p_tournament_id uuid,
  p_patch jsonb,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_started boolean;
  -- Keys that define the money/format/field and are frozen once play begins.
  v_locked_keys text[] := array[
    'buy_in_amount', 'payout_structure', 'rebuys_allowed', 'rebuy_close_level',
    'is_pko', 'bounty_start_amount', 'bounty_start_level', 'bounty_chip', 'player_ids'
  ];
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Play has started once the clock is running OR anyone has busted. A bust that
  -- was rebought clears finish_position but leaves buy_ins > 1, so both count.
  select coalesce((t.clock->>'started')::boolean, false)
         or exists (
           select 1 from entries e
            where e.tournament_id = p_tournament_id
              and e.deleted_at is null
              and (e.finish_position is not null or e.buy_ins > 1)
         )
    into v_started
    from tournaments t
   where t.id = p_tournament_id;

  -- Guard: once play has started only the basic metadata may change.
  if v_started and (p_patch ?| v_locked_keys) then
    raise exception 'play_already_started' using errcode = 'P0001';
  end if;

  if p_patch ? 'location_id'
     and (p_patch->>'location_id' is null or btrim(p_patch->>'location_id') = '') then
    raise exception 'location_id is required' using errcode = 'P0001';
  end if;

  if p_patch ? 'payout_structure' then
    perform _assert_payout_sums_100(p_patch->'payout_structure');
  end if;

  update tournaments set
    date              = case when p_patch ? 'date'              then (p_patch->>'date')::date                              else date end,
    name              = case when p_patch ? 'name'              then coalesce(p_patch->>'name', '')                        else name end,
    notes             = case when p_patch ? 'notes'             then coalesce(p_patch->>'notes', '')                       else notes end,
    location_id       = case when p_patch ? 'location_id'       then (p_patch->>'location_id')::uuid                       else location_id end,
    special           = case when p_patch ? 'special'           then (p_patch->>'special')::boolean                       else special end,
    buy_in_amount     = case when p_patch ? 'buy_in_amount'     then (p_patch->>'buy_in_amount')::numeric                  else buy_in_amount end,
    payout_structure  = case when p_patch ? 'payout_structure'  then p_patch->'payout_structure'                          else payout_structure end,
    rebuys_allowed    = case when p_patch ? 'rebuys_allowed'    then (p_patch->>'rebuys_allowed')::boolean                 else rebuys_allowed end,
    -- Turning rebuys off also shuts the window; turning them on leaves the
    -- window as-is (the director opens it explicitly).
    rebuy_window_open = case when (p_patch ? 'rebuys_allowed') and ((p_patch->>'rebuys_allowed')::boolean is false) then false else rebuy_window_open end,
    rebuy_close_level = case when p_patch ? 'rebuy_close_level' then nullif(p_patch->>'rebuy_close_level', '')::int        else rebuy_close_level end,
    is_pko            = case when p_patch ? 'is_pko'            then (p_patch->>'is_pko')::boolean                         else is_pko end,
    bounty_start_amount = case when p_patch ? 'bounty_start_amount' then coalesce(nullif(p_patch->>'bounty_start_amount', '')::numeric, 0) else bounty_start_amount end,
    bounty_start_level  = case when p_patch ? 'bounty_start_level'  then nullif(p_patch->>'bounty_start_level', '')::int   else bounty_start_level end,
    bounty_chip         = case when p_patch ? 'bounty_chip'         then coalesce(nullif(p_patch->>'bounty_chip', '')::numeric, 2.50) else bounty_chip end,
    version = v_version + 1
  where id = p_tournament_id;

  -- Optional roster replacement (pre-start only; the guard above rejects it
  -- otherwise). Add newly-listed players, drop the de-listed ones, and clear the
  -- now-stale seat draw so the director redraws.
  if p_patch ? 'player_ids' then
    update entries set deleted_at = now()
     where tournament_id = p_tournament_id
       and deleted_at is null
       and player_id not in (
         select x::uuid from jsonb_array_elements_text(p_patch->'player_ids') x
       );

    insert into entries (tournament_id, player_id, buy_ins, late_entry)
    select p_tournament_id, x::uuid, 1, false
      from jsonb_array_elements_text(p_patch->'player_ids') x
     where not exists (
       select 1 from entries e
        where e.tournament_id = p_tournament_id
          and e.player_id = x::uuid
          and e.deleted_at is null
     );

    update entries set table_no = null, seat_no = null
     where tournament_id = p_tournament_id and deleted_at is null;
    update tournaments set seating = null where id = p_tournament_id;
  end if;

  return v_version + 1;
end;
$$;
