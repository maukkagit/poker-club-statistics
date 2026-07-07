-- Poker Club Statistics — per-tournament photo.
--
-- Run once in the Supabase SQL editor after 0018_title_gradient.sql. Idempotent.
--
-- Adds a single optional photo per tournament. The file itself lives in a
-- public Storage bucket; the tournament row keeps only the resulting public
-- URL. Uploads/deletes go through the server (service-role key), so no Storage
-- RLS policies are needed — the bucket is public-read for the feed/summary, and
-- the service role bypasses RLS for writes. See app/api/tournaments/[id]/image.

alter table tournaments
  add column if not exists image_url text;

-- Public bucket for tournament photos. `public = true` makes the CDN
-- `.../object/public/...` URLs readable without auth, which is what the home
-- feed and results summary use.
insert into storage.buckets (id, name, public)
values ('tournament-images', 'tournament-images', true)
on conflict (id) do update set public = true;
