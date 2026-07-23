-- Batch record add-ons for multiple alive players in one version bump.
-- Each selected player gets addons + 1 (same semantics as record_addon).

create or replace function record_addons(
  p_tournament_id uuid,
  p_player_ids uuid[],
  p_expected_version int
)
returns int
language plpgsql
as $$
declare
  v_version int;
  v_allowed boolean;
  v_id uuid;
  v_alive boolean;
  v_count int := 0;
begin
  v_version := _assert_version(p_tournament_id, p_expected_version);

  if p_player_ids is null or cardinality(p_player_ids) = 0 then
    raise exception 'no_players' using errcode = 'P0001';
  end if;

  select addons_allowed into v_allowed from tournaments where id = p_tournament_id;
  if not coalesce(v_allowed, false) then
    raise exception 'addons_not_allowed' using errcode = 'P0001';
  end if;

  foreach v_id in array p_player_ids loop
    select (finish_position is null) into v_alive
      from entries
     where tournament_id = p_tournament_id and player_id = v_id and deleted_at is null;
    if v_alive is null then
      raise exception 'entry_not_found' using errcode = 'P0002';
    end if;
    if not v_alive then
      raise exception 'player_already_busted' using errcode = 'P0001';
    end if;

    update entries
       set addons = addons + 1
     where tournament_id = p_tournament_id and player_id = v_id and deleted_at is null;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'no_players' using errcode = 'P0001';
  end if;

  update tournaments set version = v_version + 1 where id = p_tournament_id;
  return v_version + 1;
end;
$$;
