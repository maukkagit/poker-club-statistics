-- Make a bust + rebuy ("Rebought (stays in)") undoable.
--
-- A re-entry goes straight through `record_buyin`: the player stays alive
-- (finish_position untouched), buy_ins is incremented, and in PKO a reentry
-- knockout is logged. Previously this pushed NO undo snapshot, so when 0
-- players had fully busted out the "Undo latest bustout" had nothing to revert
-- (and the button was hidden). Now:
--   * record_buyin captures a snapshot (action 'record_buyin') BEFORE mutating,
--     recording the rebuying player and the reentry knockout group id.
--   * undo_latest_bust pops whichever of the latest bust/rebuy snapshot is most
--     recent (LIFO). For a rebuy it gives back the extra buy-in and drops the
--     reentry knockout(s) (reverting the eliminator's bounty), restoring seating
--     and standings just like a bust undo.

-- ---------------------------------------------------------------------------
-- record_buyin — now snapshots the pre-rebuy state for undo
-- ---------------------------------------------------------------------------
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

  -- Pre-assign the knockout group id so it can be stored on the undo snapshot
  -- (used to drop the reentry's bounty transfer when undone).
  v_event_id := gen_random_uuid();

  -- Snapshot BEFORE mutating so the re-entry can be undone via the same LIFO
  -- stack as a full bustout. Records the rebuying player + knockout group id
  -- alongside the standard seating/standings capture.
  insert into tournament_undo (tournament_id, action, state)
  select
    p_tournament_id,
    'record_buyin',
    jsonb_build_object(
      'player_id', p_player_id,
      'bust_event_id', v_event_id,
      'seating', t.seating,
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', e.player_id,
          'finish_position', e.finish_position,
          'table_no', e.table_no,
          'seat_no', e.seat_no))
        from entries e
       where e.tournament_id = p_tournament_id and e.deleted_at is null
      ), '[]'::jsonb)
    )
  from tournaments t
 where t.id = p_tournament_id;

  update entries
     set buy_ins = buy_ins + 1
   where tournament_id = p_tournament_id and player_id = p_player_id and deleted_at is null;

  -- PKO: log the knockout(s) that triggered this re-entry (reentry=true), split
  -- across multiple winners for a chopped pot just like record_bust.
  if p_eliminator_player_ids is not null and jsonb_array_length(p_eliminator_player_ids) > 0 then
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
-- undo_latest_bust — now also undoes the latest re-entry (LIFO across both)
-- ---------------------------------------------------------------------------
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
  v_action text;
  v_state jsonb;
  v_ko uuid;
  v_event uuid;
  v_player uuid;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  -- Most recent bust OR rebuy snapshot (whichever stacked last).
  select seq, action, state into v_seq, v_action, v_state
    from tournament_undo
   where tournament_id = p_tournament_id and action in ('record_bust', 'record_buyin')
   order by seq desc
   limit 1;
  if v_seq is null then
    raise exception 'no_bust_to_undo' using errcode = 'P0001';
  end if;

  -- Restore seating (button positions etc.) from the snapshot.
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

  if v_action = 'record_buyin' then
    -- Give back the extra buy-in this re-entry added.
    v_player := nullif(v_state->>'player_id', '')::uuid;
    if v_player is not null then
      update entries
         set buy_ins = greatest(1, buy_ins - 1)
       where tournament_id = p_tournament_id and player_id = v_player and deleted_at is null;
    end if;
    -- Drop the reentry knockout(s) so the eliminator's bounty transfer reverts.
    v_event := nullif(v_state->>'bust_event_id', '')::uuid;
    if v_event is not null then
      delete from knockouts where tournament_id = p_tournament_id and bust_event_id = v_event;
    end if;
  else
    -- record_bust: drop the knockout(s) this bust created (new snapshots stamp
    -- the whole elimination's bust_event_id; older ones a single knockout_id;
    -- oldest of all fall back to the most recent real bust).
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
  end if;

  -- Drop this snapshot and everything stacked after it.
  delete from tournament_undo
   where tournament_id = p_tournament_id and seq >= v_seq;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;
