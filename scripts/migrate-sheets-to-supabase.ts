// One-time migration: copies the live Google Sheet into Supabase (Postgres).
//
// Prerequisites:
//   1. Run supabase/migrations/0001_init.sql in your Supabase project.
//   2. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and the legacy GOOGLE_*
//      vars in .env.local (the GOOGLE_* are only needed for this script).
//
// Usage:
//   npm run migrate-to-supabase                # dry run: prints source/dest counts
//   npm run migrate-to-supabase -- --apply     # insert (refuses if dest is non-empty)
//   npm run migrate-to-supabase -- --truncate  # clear dest first, then insert
//
// The migration preserves existing UUIDs, created_at timestamps, null
// location_ids, payout structures, state and special flags so the Postgres DB
// is a faithful snapshot of the sheet (not a re-derived import). Rows are
// inserted FK-safe: players -> locations -> tournaments -> entries.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import * as sheets from "../lib/sheets";

const APPLY = process.argv.includes("--apply") || process.argv.includes("--truncate");
const TRUNCATE = process.argv.includes("--truncate");
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Drop empty-string created_at so the column's default now() applies (legacy
// rows that escaped the timestamp backfill). Postgres can't store "" in a
// timestamptz.
function withCreatedAt<T extends Record<string, any>>(row: T, created_at: string): T {
  if (created_at && created_at.trim()) return { ...row, created_at };
  return row;
}

async function insertChunked(client: ReturnType<typeof db>, table: string, rows: any[]) {
  const SIZE = 500;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);
    const { error } = await client.from(table).insert(chunk);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

async function countAll(client: ReturnType<typeof db>) {
  const out: Record<string, number> = {};
  for (const table of ["players", "locations", "tournaments", "entries"]) {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    out[table] = count ?? 0;
  }
  return out;
}

async function main() {
  const client = db();

  console.log("Reading source data from Google Sheets…");
  const [players, locations, tournaments, entries] = await Promise.all([
    sheets.listPlayers(),
    sheets.listLocations(),
    sheets.listTournaments(),
    sheets.listEntries(),
  ]);
  console.log(
    `  source: ${players.length} players, ${locations.length} locations, ` +
    `${tournaments.length} tournaments, ${entries.length} entries`,
  );

  const before = await countAll(client);
  console.log(`  destination (before): ${JSON.stringify(before)}`);

  if (!APPLY) {
    console.log("\nDry run — no changes written. Re-run with --apply (or --truncate).");
    return;
  }

  const destNonEmpty = Object.values(before).some(n => n > 0);
  if (destNonEmpty && !TRUNCATE) {
    throw new Error("Destination is not empty. Re-run with --truncate to clear it first.");
  }

  if (TRUNCATE) {
    console.log("Truncating destination tables…");
    // FK-safe order: children first.
    for (const table of ["entries", "tournaments", "locations", "players"]) {
      const { error } = await client.from(table).delete().neq("id", NIL_UUID);
      if (error) throw new Error(`truncate ${table}: ${error.message}`);
    }
  }

  console.log("Inserting players…");
  await insertChunked(client, "players", players.map(p =>
    withCreatedAt({ id: p.id, name: p.name }, p.created_at)));

  console.log("Inserting locations…");
  await insertChunked(client, "locations", locations.map(l =>
    withCreatedAt({ id: l.id, name: l.name }, l.created_at)));

  console.log("Inserting tournaments…");
  await insertChunked(client, "tournaments", tournaments.map(t =>
    withCreatedAt({
      id: t.id,
      date: t.date,
      name: t.name ?? "",
      buy_in_amount: t.buy_in_amount,
      payout_structure: t.payout_structure,
      notes: t.notes ?? "",
      location_id: t.location_id ?? null,
      state: t.state,
      special: t.special,
    }, t.created_at)));

  console.log("Inserting entries…");
  await insertChunked(client, "entries", entries.map(e => ({
    id: e.id,
    tournament_id: e.tournament_id,
    player_id: e.player_id,
    buy_ins: e.buy_ins,
    finish_position: e.finish_position,
    payout_override: e.payout_override,
  })));

  const after = await countAll(client);
  console.log(`\nDone. Destination (after): ${JSON.stringify(after)}`);
  console.log("Next: run `npm run verify-migration` and compare the leaderboard.");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
