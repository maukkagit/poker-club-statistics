// Imports scripts/legacy_data.json into the Google Sheet via batched API writes.
// Run AFTER `npm run init-sheet`. Idempotency: refuses to run unless sheet is empty
// (or you pass --force to wipe and reimport).
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { readFileSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import { google } from "googleapis";

type LegacyPlayer = string;
type LegacyEntry = {
  player_name: string;
  buy_ins: number;
  finish_position: number | null;
  payout_override: number;
};
type LegacyTournament = {
  game_number: number;
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: { position: number; pct: number }[];
  notes: string;
  entries: LegacyEntry[];
};
type Legacy = { players: LegacyPlayer[]; tournaments: LegacyTournament[] };

const FORCE = process.argv.includes("--force");

async function main() {
  const data: Legacy = JSON.parse(
    readFileSync(join(__dirname, "legacy_data.json"), "utf8"),
  );

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) throw new Error("Missing env vars");

  const auth = new google.auth.JWT({
    email, key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // 1. Sanity-check that schema exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const titles = new Set((meta.data.sheets ?? []).map(s => s.properties?.title));
  for (const tab of ["Players", "Tournaments", "Entries"]) {
    if (!titles.has(tab)) throw new Error(`Tab "${tab}" missing. Run \`npm run init-sheet\` first.`);
  }

  // 2. Check current contents
  const existing = await Promise.all(["Players", "Tournaments", "Entries"].map(t =>
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${t}!A2:A` })
  ));
  const counts = existing.map(r => (r.data.values ?? []).filter(row => row[0]).length);
  console.log(`Current rows — Players: ${counts[0]}, Tournaments: ${counts[1]}, Entries: ${counts[2]}`);
  const hasData = counts.some(c => c > 0);
  if (hasData && !FORCE) {
    console.error("✗ Sheet is not empty. Re-run with --force to wipe and reimport.");
    process.exit(1);
  }
  if (hasData && FORCE) {
    console.log("--force given: wiping existing data rows…");
    for (const tab of ["Players", "Tournaments", "Entries"]) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId, range: `${tab}!A2:Z`,
      });
    }
  }

  // 3. Build rows in memory
  const now = new Date().toISOString();

  const playerRows: (string | number)[][] = [];
  const playerIdByName = new Map<string, string>();
  for (const name of data.players) {
    const id = uuid();
    playerIdByName.set(name, id);
    playerRows.push([id, name, now]);
  }

  const tournamentRows: (string | number)[][] = [];
  const entryRows: (string | number | "")[][] = [];
  for (const t of data.tournaments) {
    const tid = uuid();
    tournamentRows.push([
      tid, t.date, t.name, t.buy_in_amount,
      JSON.stringify(t.payout_structure), t.notes,
    ]);
    for (const e of t.entries) {
      const pid = playerIdByName.get(e.player_name);
      if (!pid) {
        console.warn(`  WARN: entry references unknown player "${e.player_name}" in ${t.name}, skipping`);
        continue;
      }
      entryRows.push([
        uuid(), tid, pid, e.buy_ins,
        e.finish_position ?? "",
        e.payout_override,
      ]);
    }
  }

  console.log(`Prepared ${playerRows.length} players, ${tournamentRows.length} tournaments, ${entryRows.length} entries.`);

  // 4. Batched append — one call per tab
  async function append(tab: string, rows: (string | number | "")[][]) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId, range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    console.log(`  ✓ Appended ${rows.length} rows to ${tab}`);
  }

  await append("Players", playerRows);
  await append("Tournaments", tournamentRows);
  await append("Entries", entryRows);

  console.log("\n✓ Import complete.");
}

main().catch(err => {
  console.error("✗ Import failed:", err);
  process.exit(1);
});
