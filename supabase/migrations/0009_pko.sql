-- Poker Club Statistics — Progressive Knockout (PKO) bounty support.
--
-- Run once in the Supabase SQL editor after 0008_chat_system_messages.sql.
-- Idempotent: safe to re-run.
--
-- Adds the delayed-PKO format: a per-tournament bounty configuration, a
-- `knockouts` ledger (who busted whom, in which phase, and whether the
-- eliminated player re-entered), and extends the bust/buyin/undo RPCs to record
-- those knockouts. All bounty *values* are derived from this ledger in app code
-- (lib/pko.ts), so the math (compounding + rounding + undo) stays in one place.

-- ---------------------------------------------------------------------------
-- Tournament PKO configuration
-- ---------------------------------------------------------------------------
-- For PKO tournaments `buy_in_amount` holds the REGULAR prize-pool contribution
-- only; `bounty_start_amount` is the starting bounty granted per buy-in/re-entry.
-- The bounty phase (cashable knockouts) begins at `bounty_start_level`.
alter table tournaments
  add column if not exists is_pko boolean not null default false;
alter table tournaments
  add column if not exists bounty_start_amount numeric not null default 0;
alter table tournaments
  add column if not exists bounty_start_level int;
alter table tournaments
  add column if not exists bounty_chip numeric not null default 2.50;

-- ---------------------------------------------------------------------------
-- Knockouts ledger
-- ---------------------------------------------------------------------------
-- One row per elimination (and per bust-then-re-entry). `phase` is computed in
-- app code from the live clock at the moment of the bust and stamped here so
-- recomputation is stable even if the structure is later edited. `reentry`
-- marks that the eliminated player bought back in (their bounty resets to the
-- starting amount in the derivation).
create table if not exists knockouts (
  id                    uuid primary key default gen_random_uuid(),
  tournament_id         uuid not null references tournaments(id) on delete cascade,
  eliminator_player_id  uuid not null references players(id) on delete restrict,
  eliminated_player_id  uuid not null references players(id) on delete restrict,
  phase                 text not null check (phase in ('pre', 'bounty')),
  reentry               boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists knockouts_tournament_created_idx
  on knockouts (tournament_id, created_at);

-- Split-pot support: a single elimination can be shared by several winners when
-- the pot holding the busted player's last chips is chopped (Attachment 4 —
-- "Bounty allocation edge cases"). Every row for one elimination shares a
-- `bust_event_id`; `split_index` orders the winners for the odd-€2.50-chip
-- tie-break (0 = the eligible player closest to the left of the button, who
-- receives the indivisible chip first). Existing solo rows become their own
-- single-winner event.
alter table knockouts
  add column if not exists bust_event_id uuid;
alter table knockouts
  add column if not exists split_index smallint not null default 0;
update knockouts set bust_event_id = id where bust_event_id is null;
create index if not exists knockouts_event_idx
  on knockouts (tournament_id, bust_event_id, split_index);

-- ---------------------------------------------------------------------------
-- create_tournament_with_seating(payload) — extended for PKO config
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
     special, seating, rebuys_allowed, rebuy_window_open, version,
     structure, starting_stack, clock,
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
-- record_bust — now records who eliminated whom (PKO knockout ledger)
-- ---------------------------------------------------------------------------
-- Drops the old overloads so there's a single canonical signature. The
-- eliminators are optional: pass a JSON array of player-id strings (one entry,
-- or several when a chopped pot splits the bounty — ordered by odd-chip
-- priority, the player closest to the left of the button first). Null/empty =>
-- no knockout row (non-PKO). Otherwise identical to 0005 (auto-pause on win).
drop function if exists record_bust(uuid, uuid, int);
drop function if exists record_bust(uuid, uuid, uuid, text, int);
create or replace function record_bust(
  p_tournament_id uuid,
  p_player_id uuid,
  p_eliminator_player_ids jsonb,
  p_phase text,
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
  v_event_id uuid;
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

  -- PKO: log the knockout(s) for this elimination (no re-entry). A chopped pot
  -- splits the bounty across several winners, so we write one row per winner
  -- sharing a bust_event_id, ordered by split_index (the host's odd-chip
  -- priority). Stash the event id on the snapshot we just took so undo drops the
  -- whole elimination at once, reverting the derived bounty/cash transfer.
  if p_eliminator_player_ids is not null and jsonb_array_length(p_eliminator_player_ids) > 0 then
    v_event_id := gen_random_uuid();
    insert into knockouts
      (tournament_id, eliminator_player_id, eliminated_player_id, phase, reentry, bust_event_id, split_index)
    select p_tournament_id, w.pid::uuid, p_player_id, coalesce(p_phase, 'pre'), false,
           v_event_id, (w.ord - 1)::smallint
      from jsonb_array_elements_text(p_eliminator_player_ids) with ordinality as w(pid, ord);

    update tournament_undo
       set state = state || jsonb_build_object('bust_event_id', v_event_id)
     where tournament_id = p_tournament_id
       and seq = (select max(seq) from tournament_undo where tournament_id = p_tournament_id);
  end if;

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
-- record_buyin — now records the preceding knockout for PKO re-entries
-- ---------------------------------------------------------------------------
-- A "rebuy" in the live manager means the player busted out and bought back in.
-- For PKO we log that knockout with reentry=true so the eliminated player's
-- bounty transfers to the eliminator and then resets to the starting bounty.
drop function if exists record_buyin(uuid, uuid, int);
drop function if exists record_buyin(uuid, uuid, uuid, text, int);
create or replace function record_buyin(
  p_tournament_id uuid,
  p_player_id uuid,
  p_eliminator_player_ids jsonb,
  p_phase text,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_active boolean;
  v_alive boolean;
  v_event_id uuid;
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

  -- PKO: log the knockout(s) that triggered this re-entry (reentry=true), split
  -- across multiple winners for a chopped pot just like record_bust.
  if p_eliminator_player_ids is not null and jsonb_array_length(p_eliminator_player_ids) > 0 then
    v_event_id := gen_random_uuid();
    insert into knockouts
      (tournament_id, eliminator_player_id, eliminated_player_id, phase, reentry, bust_event_id, split_index)
    select p_tournament_id, w.pid::uuid, p_player_id, coalesce(p_phase, 'pre'), true,
           v_event_id, (w.ord - 1)::smallint
      from jsonb_array_elements_text(p_eliminator_player_ids) with ordinality as w(pid, ord);
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- undo_latest_bust — also drops the bust's own knockout row
-- ---------------------------------------------------------------------------
-- Same snapshot rewind as 0002, plus: remove the knockout this bust created
-- (its id is stamped on the snapshot) so the derived bounty/cash transfer
-- reverts with the standings. Snapshots stack, so calling this repeatedly
-- undoes bust-outs one at a time in LIFO order — each step reverting that
-- bust's bounty and cashed-out money respectively.
create or replace function undo_latest_bust(
  p_tournament_id uuid,
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_seq bigint;
  v_state jsonb;
  v_ko uuid;
  v_event uuid;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  select seq, state into v_seq, v_state
    from tournament_undo
   where tournament_id = p_tournament_id and action = 'record_bust'
   order by seq desc
   limit 1;
  if v_seq is null then
    raise exception 'no_bust_to_undo' using errcode = 'P0001';
  end if;

  -- Restore the seating jsonb (button positions etc.) from the snapshot.
  update tournaments set seating = v_state->'seating' where id = p_tournament_id;

  -- Clear all seats/standings, then replay the snapshot's per-entry values.
  update entries set finish_position = null, table_no = null, seat_no = null
   where tournament_id = p_tournament_id and deleted_at is null;

  update entries e
     set finish_position = nullif(s->>'finish_position', '')::int,
         table_no        = nullif(s->>'table_no', '')::smallint,
         seat_no         = nullif(s->>'seat_no', '')::smallint
    from jsonb_array_elements(v_state->'entries') s
   where e.tournament_id = p_tournament_id
     and e.player_id = (s->>'player_id')::uuid
     and e.deleted_at is null;

  -- Drop the knockout(s) this bust created so the derived bounty/cash transfer
  -- is reverted too. New snapshots stamp the whole elimination's bust_event_id
  -- (one row per split winner); older ones stamp a single knockout_id; oldest of
  -- all fall back to the most recent real bust.
  v_event := nullif(v_state->>'bust_event_id', '')::uuid;
  if v_event is not null then
    delete from knockouts where tournament_id = p_tournament_id and bust_event_id = v_event;
  else
    v_ko := nullif(v_state->>'knockout_id', '')::uuid;
    if v_ko is null then
      select id into v_ko
        from knockouts
       where tournament_id = p_tournament_id and reentry = false
       order by created_at desc
       limit 1;
    end if;
    if v_ko is not null then
      delete from knockouts where id = v_ko;
    end if;
  end if;

  -- Drop this snapshot and everything stacked after it.
  delete from tournament_undo
   where tournament_id = p_tournament_id and seq >= v_seq;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;
