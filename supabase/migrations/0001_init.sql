-- Poker Club Statistics — initial Postgres schema (Supabase)
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`) before
-- pointing the app at the database. It is idempotent: safe to re-run.
--
-- Replaces the former Google Sheets backend. The four tables mirror the old
-- sheet tabs (Players, Locations, Tournaments, Entries) with Postgres-native
-- types plus best-practice fields: updated_at (trigger-maintained), real
-- foreign keys, CHECK/UNIQUE constraints, indexes, and soft-delete (deleted_at).

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists unaccent;   -- diacritic-insensitive location uniqueness

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh on every UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- IMMUTABLE wrapper around unaccent() so it can be used in an index expression
-- (the stock unaccent() is only STABLE). Mirrors the app's locNorm(): strip
-- diacritics, lower-case. (Trimming is handled in the app before insert.)
create or replace function f_unaccent(text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(unaccent('unaccent', $1));
$$;

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------
create table if not exists locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Case- and diacritic-insensitive uniqueness for live (non-deleted) rows. The
-- app's createLocation() de-dupes first; this is the database backstop.
create unique index if not exists locations_name_norm_uniq
  on locations (f_unaccent(name))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- tournaments
-- ---------------------------------------------------------------------------
create table if not exists tournaments (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  name             text not null default '',
  buy_in_amount    numeric not null check (buy_in_amount >= 0),
  payout_structure jsonb not null default '[]'::jsonb,
  notes            text not null default '',
  -- Nullable: legacy tournaments imported before locations existed have none.
  -- The app requires a location on create/update; RESTRICT blocks deleting a
  -- location that is still referenced.
  location_id      uuid references locations (id) on delete restrict,
  state            text not null default 'Finished' check (state in ('Active', 'Finished')),
  special          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists tournaments_location_id_idx on tournaments (location_id);
create index if not exists tournaments_date_idx on tournaments (date);

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------
create table if not exists entries (
  id              uuid primary key default gen_random_uuid(),
  -- Entries belong to a tournament; deleting a tournament hard-cascades its
  -- entries. (The app soft-deletes both together in normal operation.)
  tournament_id   uuid not null references tournaments (id) on delete cascade,
  player_id       uuid not null references players (id) on delete restrict,
  -- >= 0 (not >= 1) so legacy rows that recorded 0 buy-ins still import.
  buy_ins         integer not null default 0 check (buy_ins >= 0),
  finish_position integer check (finish_position >= 1),
  payout_override numeric,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists entries_tournament_id_idx on entries (tournament_id);
create index if not exists entries_player_id_idx on entries (player_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists players_set_updated_at on players;
create trigger players_set_updated_at before update on players
  for each row execute function set_updated_at();

drop trigger if exists locations_set_updated_at on locations;
create trigger locations_set_updated_at before update on locations
  for each row execute function set_updated_at();

drop trigger if exists tournaments_set_updated_at on tournaments;
create trigger tournaments_set_updated_at before update on tournaments
  for each row execute function set_updated_at();

drop trigger if exists entries_set_updated_at on entries;
create trigger entries_set_updated_at before update on entries
  for each row execute function set_updated_at();
