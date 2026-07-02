-- Poker Club Statistics — director-controlled animated title/prize gradient.
--
-- Run once in the Supabase SQL editor after 0017_update_tournament_info.sql.
-- Idempotent.
--
-- Purely cosmetic: when on, the public projector clock (the /clock/<token>
-- viewer link) fills the tournament name, prize pool and payout figures with a
-- moving green gradient. The director flips it from the live manager and it
-- propagates to every viewer via the public clock payload.

alter table tournaments
  add column if not exists title_gradient_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- set_title_gradient(tournament_id, enabled, expected_version)
-- ---------------------------------------------------------------------------
-- Version-checked like every other live action so the director console stays in
-- sync.
create or replace function set_title_gradient(
  p_tournament_id uuid,
  p_enabled boolean,
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
     set title_gradient_enabled = coalesce(p_enabled, title_gradient_enabled),
         version = v_version + 1
   where id = p_tournament_id;
  return v_version + 1;
end;
$$;
