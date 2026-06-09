# Poker Club Statistics

A small web app to replace the legacy "Poker Club statistics.xlsx" workflow. Built with
Next.js 14 (App Router) + TypeScript + Tailwind + Recharts. Data lives in a Supabase
(Postgres) database, with stats computed at read time from the raw `entries` rows.

## Features

- Create tournaments with date, buy-in, location, and a custom payout % structure (`60/25/15` by default).
- Add existing players or create new players inline while building a tournament.
- Tag each tournament with a location (e.g. "Maukka's house") via a typeahead that
suggests previously-used locations or creates a new one inline. Manage the list
on the **Locations** tab.
- Edit any tournament afterward: change a player's buy-in count, finish position, or override
their payout if there was a deal at the final table.
- Dashboard with per-player stats (tournaments played, total buy-ins, cost, winnings,
net profit, average per tournament) and a cumulative-net-profit chart over time
with per-player toggles.
- Lightweight password gate suitable for a private friend group.

## Architecture

```
┌──────────────────┐   HTTPS    ┌─────────────────────────┐  postgrest ┌────────────────┐
│  Browser (UI)    │ ─────────▶ │ Next.js App on Vercel   │ ─────────▶ │ Supabase       │
│  React + Recharts│            │ - Server components     │            │ (Postgres)     │
│                  │ ◀───────── │ - /api routes           │ ◀───────── │ service-role   │
└──────────────────┘   JSON     │ - middleware-based auth │            │ key, no RLS    │
                                └─────────────────────────┘            └────────────────┘
```

- **Computed at read time.** Net profits, cumulative series, and rankings are derived from
raw `entries` rows in `lib/db.ts` so the tables stay a pure source of truth.
- **Soft deletes.** Players, locations and tournaments are never hard-deleted — they get a
`deleted_at` timestamp and are filtered out of every read.
- **Auth.** Single shared password (`APP_PASSWORD`), HMAC-signed cookie, enforced by
`middleware.ts`. The DB is reached with the service-role key from server code only, so RLS
is not relied upon for access control.

## Database schema

Four tables (see `supabase/migrations/0001_init.sql`). Every table has `created_at`,
`updated_at` (trigger-maintained) and `deleted_at` (soft delete) timestamps.

### `players` / `locations`

`id (uuid pk) | name (text) | created_at | updated_at | deleted_at`

`locations` is a lookup table referenced from `tournaments.location_id`. Names are unique
case- and diacritic-insensitively (enforced by a `unaccent`-based unique index plus
app-level de-duplication) so "Maukka", "maukka", and "Maukka " never produce three rows.
A location can't be deleted while any live tournament references it (`ON DELETE RESTRICT`).

### `tournaments`

`id (uuid pk) | date | name | buy_in_amount (numeric) | payout_structure (jsonb) | notes |
location_id (uuid fk, nullable) | state | special (bool) | created_at | updated_at | deleted_at`

`payout_structure` is a JSON array, e.g. `[{"position":1,"pct":60},{"position":2,"pct":25},{"position":3,"pct":15}]`,
validated in the app to sum to 100. `location_id` is nullable for legacy rows imported
before locations existed (the editor requires one going forward). `state` is
`'Active' | 'Finished'` (CHECK-constrained); Active tournaments are excluded from stats.

### `entries`

`id (uuid pk) | tournament_id (fk) | player_id (fk) | buy_ins (int) | finish_position (int, null) |
payout_override (numeric, null) | created_at | updated_at | deleted_at`

- `tournament_id` cascades on delete; `buy_ins >= 0` and `finish_position >= 1` are CHECK-constrained.
- `buy_ins` counts the player's total buy-ins including re-entries / rebuys.
- `payout_override`, if non-null, replaces the computed % payout for that entry (how "deals"
are recorded). Otherwise payout = `(pct/100) * total_pool` where
`total_pool = SUM(buy_ins) * buy_in_amount`.

## Setup

### 1. Create the database

1. In your Supabase project, open the **SQL editor** and run
   `supabase/migrations/0001_init.sql`. This creates the four tables, constraints,
   indexes and `updated_at` triggers. (It's idempotent — safe to re-run.)
2. Project settings → API → copy the **Project URL** and the **service_role** key.

### 2. Local install

```bash
cp .env.example .env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# APP_PASSWORD, SESSION_SECRET (any random 32+ char string)

npm install
npm run dev            # http://localhost:3000
```

Sign in with `APP_PASSWORD`, then add a player and a tournament.

`npm run verify-migration` prints the current leaderboard straight from the database — a
handy sanity check (the sum of all net profits should be ~€0 for a closed zero-sum group).

> The historical data was migrated one-time from the original Google Sheets backend. That
> migration tooling (and the `googleapis` dependency) has since been removed; the database
> is now the sole source of truth.

### 3. Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD` and `SESSION_SECRET`
   in Vercel → Project Settings → Environment Variables.
4. Deploy. (The schema is created by step 1; there's no per-deploy bootstrap.)

## Assumptions / decisions

- The legacy sheet's "net profit per cell" model is preserved — we just split it into
`buy_ins` × `buy_in_amount` (cost) and `payout` (override or computed from %). That makes
re-entries and deals first-class instead of being encoded as opaque negative numbers.
- Inclusion criteria from the old sheet (≥4 players, ≥€10 buy-in) are *policy* and are not
enforced in code — you can still create a 2-person test tournament. Add validation later
if desired.
- A player without a `finish_position` and without a `payout_override` is treated as having
won €0 (they busted out of the money). Their `buy_ins * buy_in_amount` becomes pure loss.
- Cumulative chart points are placed at tournament dates; multiple tournaments on the same
day still render as separate points in insertion order.

## Future extensions worth considering

- Per-game points / leaderboard system (Hendon Mob-style POY scoring).
- Track rebuys separately from initial buy-ins.
- CSV import of legacy spreadsheet rows.
- Per-player avatars and notes.

