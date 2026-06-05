# Poker Club Statistics

A small web app to replace the legacy "Poker Club statistics.xlsx" workflow. Built with
Next.js 14 (App Router) + TypeScript + Tailwind + Recharts. Data lives in a Google Sheet so
nothing is hidden in a database — you can always open the sheet and audit / hand-fix rows.

## Features

- Create tournaments with date, buy-in, and a custom payout % structure (`60/25/15` by default).
- Add existing players or create new players inline while building a tournament.
- Edit any tournament afterward: change a player's buy-in count, finish position, or override
their payout if there was a deal at the final table.
- Dashboard with per-player stats (tournaments played, total buy-ins, cost, winnings,
net profit, average per tournament) and a cumulative-net-profit chart over time
with per-player toggles.
- Lightweight password gate suitable for a private friend group.

## Architecture

```
┌──────────────────┐   HTTPS    ┌─────────────────────────┐   API   ┌────────────────┐
│  Browser (UI)    │ ─────────▶ │ Next.js App on Vercel   │ ──────▶ │ Google Sheets  │
│  React + Recharts│            │ - Server components     │         │ (the database) │
│                  │ ◀───────── │ - /api routes           │ ◀────── │ via service    │
└──────────────────┘   JSON     │ - middleware-based auth │         │ account JWT    │
                                └─────────────────────────┘         └────────────────┘
```

- **Stateless API.** All persistent state is in the sheet; the app holds no DB.
- **Computed at read time.** Net profits, cumulative series, and rankings are derived from
raw `Entries` rows in `lib/sheets.ts` so the spreadsheet stays a pure source of truth.
- **Auth.** Single shared password (`APP_PASSWORD`), HMAC-signed cookie, enforced by
`middleware.ts`.

## Google Sheets schema

One spreadsheet with four tabs. Headers live in row 1 — do not reorder columns by hand.

### `Players`

| id (uuid) | name | created_at (ISO) |

### `Tournaments`

| id (uuid) | date (YYYY-MM-DD) | name | buy_in_amount (EUR) | payout_structure (JSON) | notes |

`payout_structure` is a JSON array, e.g. `[{"position":1,"pct":60},{"position":2,"pct":25},{"position":3,"pct":15}]`.
It must sum to 100.

### `Entries`

| id (uuid) | tournament_id | player_id | buy_ins (int) | finish_position (int or blank) | payout_override (EUR or blank) |

- `buy_ins` counts the player's total buy-ins including re-entries / rebuys.
- `payout_override`, if non-blank, replaces the computed % payout for that entry. This is how
"deals" between final-table players are recorded. If blank, payout = `(pct/100) * total_pool`
where `total_pool = SUM(buy_ins) * buy_in_amount`.

### `Meta`

Reserved for future migrations.

## Setup

### 1. Google Cloud project + service account

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create / select a project.
2. APIs & Services → Enable APIs → enable **Google Sheets API**.
3. APIs & Services → Credentials → Create credentials → **Service account**. Give it a name.
4. On the service account, Keys → Add Key → JSON. Save the file safely.

### 2. The spreadsheet

1. Create a new Google Sheet inside the Drive folder
  `[1_uDN8Wyh8Y3HRrJTsdHgF_Qrf8pMagGT](https://drive.google.com/drive/u/0/folders/1_uDN8Wyh8Y3HRrJTsdHgF_Qrf8pMagGT)`
   (e.g. "Poker Club DB").
2. Copy its **spreadsheet ID** (the long string between `/d/` and `/edit` in the URL).
3. Share the sheet with the service account's `client_email`, giving it **Editor** access.

### 3. Local install

```bash
cp .env.example .env.local
# fill in GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY,
# APP_PASSWORD, SESSION_SECRET (any random 32+ char string)

npm install
npm run init-sheet     # creates the Players/Tournaments/Entries/Meta tabs + headers
npm run dev            # http://localhost:3000
```

Sign in with `APP_PASSWORD`, then add a player and a tournament.

### 3a. Import the legacy spreadsheet (one-time)

If you want the 89 historical games from `legacy_xlsx/Poker Club statistics.xlsx`
loaded into the new sheet:

```bash
python3 scripts/legacy_to_json.py   # produces scripts/legacy_data.json
npm run import-legacy                # writes 33 players + 89 tournaments to Sheets
```

The legacy sheet only stored net profit per cell, so the importer infers:

- **buy_in_amount** per game = GCD of the absolute loss values in that column.
- **buy_ins** per loser = `|net| / buy_in_amount` (preserves rebuy counts when losses span multiple buy-ins).
- **buy_ins** per winner = `1` (legacy has no rebuy info for winners — their net is still preserved exactly via `payout_override`).
- **payout_override** = `net + buy_ins × buy_in_amount` on every entry.
- **payout_structure** = `[{position:1,pct:100}]` placeholder — every entry overrides it, so structure doesn't affect math.

Reconstructed cumulative-net totals match the legacy "All-time net profits" column
exactly (verified against Lalli Nurmi €1012.25, Joonas Rasa €221.87, etc.).

Re-running the import on a non-empty sheet refuses unless you pass `--force`:

```bash
npm run import-legacy -- --force     # wipes data rows and reimports
```

### 4. Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. Add the same env vars in Vercel → Project Settings → Environment Variables.
  - For `GOOGLE_PRIVATE_KEY`, paste the full key with literal `\n` newlines (or actual newlines — both work).
4. Deploy. The first deploy will need `npm run init-sheet` run **once** locally against the production sheet (or call `ensureSchema()` from a one-off API hit).

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

