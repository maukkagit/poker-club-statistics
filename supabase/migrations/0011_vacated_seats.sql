-- Poker Club Statistics — remember the seat a busted player vacated.
--
-- Run once in the Supabase SQL editor after 0010_remove_player.sql. Idempotent.
--
-- When tables are rebalanced (a player moves from the biggest table to the
-- shortest), the moved player should slot into the chair a busted player just
-- vacated — not a random open seat (which, when seats_per_table is only a
-- capacity threshold, can be a seat nobody ever sat in). We record each bust's
-- seat so the live manager can reseat into it.

-- ---------------------------------------------------------------------------
-- entries.last_table_no / last_seat_no
-- ---------------------------------------------------------------------------
-- The physical seat the player last occupied before busting (seat_no/table_no
-- are cleared on a bust). Null until the player busts from a seat.
alter table entries
  add column if not exists last_table_no smallint;
alter table entries
  add column if not exists last_seat_no smallint;

-- ---------------------------------------------------------------------------
-- Trigger: stamp the vacated seat on bust
-- ---------------------------------------------------------------------------
-- Fires on the UPDATE that busts a player (finish_position goes from null to a
-- value while their seat is cleared) and copies the seat they're leaving into
-- last_table_no/last_seat_no. Localised here so every bust path (record_bust,
-- and any future one) gets the behaviour without duplicating SQL. Undo restores
-- finish_position to null, which doesn't match the condition, so the hint is
-- simply left behind and ignored once the player is live again.
create or replace function _remember_vacated_seat()
returns trigger
language plpgsql
as $$
begin
  if new.finish_position is not null and old.finish_position is null
     and old.seat_no is not null and new.seat_no is null then
    new.last_table_no := old.table_no;
    new.last_seat_no := old.seat_no;
  end if;
  return new;
end;
$$;

drop trigger if exists entries_remember_vacated_seat on entries;
create trigger entries_remember_vacated_seat
  before update on entries
  for each row
  execute function _remember_vacated_seat();
