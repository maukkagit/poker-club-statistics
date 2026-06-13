-- Poker Club Statistics — Tournament chat for the public clock viewer.
--
-- Run once in the Supabase SQL editor after 0006_clock_level_controls.sql.
-- Idempotent: safe to re-run.
--
-- Anyone with a tournament's share-token viewer link can post messages (until
-- the tournament is Finished) and read the live feed. Exactly one message per
-- tournament can be pinned at a time; pinning is gated by the site password at
-- the API layer (see app/api/public/chat/[token]/route.ts), not in the DB.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists chat_messages (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  author_name   text not null,
  body          text not null,
  pinned        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Feed lookups are "all messages for a tournament, oldest first".
create index if not exists chat_messages_tournament_created_idx
  on chat_messages (tournament_id, created_at);

-- Enforce "at most one pinned message per tournament" at the storage layer.
create unique index if not exists chat_messages_one_pin_per_tournament
  on chat_messages (tournament_id)
  where pinned;

-- ---------------------------------------------------------------------------
-- set_pinned_chat_message(tournament_id, message_id)
-- ---------------------------------------------------------------------------
-- Atomically make `message_id` the single pinned message for the tournament
-- (clearing any previous pin first). Pass a NULL message id to simply unpin.
-- Done in one statement-pair inside the function so the partial unique index
-- above can never be violated by an interleaving pin.
create or replace function set_pinned_chat_message(
  p_tournament_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
as $$
begin
  update chat_messages
     set pinned = false
   where tournament_id = p_tournament_id and pinned;
  if p_message_id is not null then
    update chat_messages
       set pinned = true
     where id = p_message_id and tournament_id = p_tournament_id;
  end if;
end;
$$;
