-- Poker Club Statistics — director-controlled clock sound effects.
--
-- Run once in the Supabase SQL editor after 0011_vacated_seats.sql. Idempotent.
--
-- Sound effects play on the public projector clock (the /clock/<token> viewer
-- link), not the director console. These two flags let the director enable or
-- disable them for the tournament from the live manager, and they propagate to
-- every viewer via the public clock payload:
--   sound_enabled            — master on/off for all clock sound effects.
--   sound_knockouts_enabled  — whether a bustout plays its own sting.

alter table tournaments
  add column if not exists sound_enabled boolean not null default true;
alter table tournaments
  add column if not exists sound_knockouts_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- set_sound_settings(tournament_id, enabled, knockouts, expected_version)
-- ---------------------------------------------------------------------------
-- Version-checked like every other live action so the director console stays in
-- sync. Sets both flags atomically; the UI passes the current value for the
-- toggle that isn't changing.
create or replace function set_sound_settings(
  p_tournament_id uuid,
  p_enabled boolean,
  p_knockouts boolean,
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
     set sound_enabled = coalesce(p_enabled, sound_enabled),
         sound_knockouts_enabled = coalesce(p_knockouts, sound_knockouts_enabled),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
