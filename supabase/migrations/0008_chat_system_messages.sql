-- Poker Club Statistics — System (tournament-director) chat messages.
--
-- Run once in the Supabase SQL editor after 0007_tournament_chat.sql.
-- Idempotent: safe to re-run.
--
-- Adds a `system` flag to chat_messages. The app posts automated announcements
-- (bust-outs, re-entries, and secured paid positions) authored as "TD" with
-- `system = true`, so the viewer can render them distinctly from player chat.

alter table chat_messages
  add column if not exists system boolean not null default false;
