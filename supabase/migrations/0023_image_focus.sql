-- Poker Club Statistics — tournament photo focal point.
--
-- Run once in the Supabase SQL editor after 0022_dynamic_payouts.sql. Idempotent.
--
-- Stores where the director tapped as the "center" of the photo (typically a
-- face), as percentages of the image width/height. Display surfaces use these
-- with CSS `object-position` so `object-cover` crops keep the subject in frame
-- instead of always using the geometric center.

alter table tournaments
  add column if not exists image_focus_x double precision,
  add column if not exists image_focus_y double precision;

comment on column tournaments.image_focus_x is
  'Horizontal focal point of image_url, 0–100 (% from left). Null = 50.';
comment on column tournaments.image_focus_y is
  'Vertical focal point of image_url, 0–100 (% from top). Null = 50.';
