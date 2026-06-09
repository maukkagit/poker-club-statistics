/**
 * Backfill payout_structure + finish_position for legacy-imported tournaments.
 *
 * Why: the original legacy import wrote every tournament with
 *   payout_structure = [{position:1, pct:100}]
 * and encoded the actual distribution as `payout_override` on each entry.
 * The UI now (correctly) treats payout_override as a manual override, making
 * every old tournament look like "100% to 1st, manually overridden". That's not
 * how those games were actually played — no past tournament used overrides.
 *
 * What this script does for each legacy tournament:
 *   1. Find entries with payout_override > 0 — those are the winners.
 *   2. Sort by payout descending; assign finish_position = 1, 2, 3, …
 *   3. Derive payout_structure from the historical payouts:
 *        pct[i] = round( payout[i] / totalPool * 100, 2 )
 *      Last slot is nudged so the sum is exactly 100.00.
 *   4. Clear payout_override on every entry (the structure now drives payouts).
 *
 * Detection of "legacy" tournament:
 *   - notes contains "Imported from legacy" (case-insensitive), AND
 *   - payout_structure is the placeholder [{position:1, pct:100}].
 *
 * Default mode is DRY-RUN. Pass --apply to write changes to Google Sheets.
 *
 * Run:
 *   npm run backfill-payouts            # dry-run, prints plan
 *   npm run backfill-payouts -- --apply # writes changes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { google } from "googleapis";
import type { Tournament, Entry, PayoutSlot } from "../lib/types";

const APPLY = process.argv.includes("--apply");

const TOURNAMENT_HEADER = ["id", "date", "name", "buy_in_amount", "payout_structure", "notes"] as const;
const ENTRY_HEADER = ["id", "tournament_id", "player_id", "buy_ins", "finish_position", "payout_override"] as const;

type TournamentRow = { tournament: Tournament; sheetRow: number };
type EntryRow = { entry: Entry; sheetRow: number };

function nearlyEqual(a: number, b: number, eps = 0.011) {
  return Math.abs(a - b) <= eps;
}

function roundTo(n: number, decimals = 2) {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function inferStructure(payouts: number[], totalPool: number): PayoutSlot[] {
  // pcts at full precision, then round each to 2 decimals, then nudge the last
  // entry so the rounded sum is exactly 100.
  const raw = payouts.map(p => (p / totalPool) * 100);
  const rounded = raw.map(p => roundTo(p, 2));
  const sum = rounded.reduce((s, x) => s + x, 0);
  const drift = roundTo(100 - sum, 2);
  if (rounded.length && drift !== 0) {
    rounded[rounded.length - 1] = roundTo(rounded[rounded.length - 1] + drift, 2);
  }
  return rounded.map((pct, i) => ({ position: i + 1, pct }));
}

async function main() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) throw new Error("Missing env vars");

  const auth = new google.auth.JWT({
    email, key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
  console.log("Fetching Tournaments + Entries…");

  const [tRes, eRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Tournaments!A1:Z",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Entries!A1:Z",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
  ]);

  const tRows = (tRes.data.values ?? []) as any[][];
  const eRows = (eRes.data.values ?? []) as any[][];

  const tournaments: TournamentRow[] = [];
  for (let i = 1; i < tRows.length; i++) {
    const r = tRows[i];
    if (!r || !r[0]) continue;
    tournaments.push({
      sheetRow: i + 1, // A1-style row number
      tournament: {
        id: String(r[0]),
        date: String(r[1] ?? ""),
        name: String(r[2] ?? ""),
        buy_in_amount: Number(r[3] ?? 0),
        payout_structure: r[4] ? JSON.parse(String(r[4])) : [],
        notes: String(r[5] ?? ""),
        // `state`, `special` and `created_at` were added later — this script
        // only ever touches legacy/finished rows, so default state/special
        // and pass through whatever `created_at` is currently in the sheet
        // (empty string for pre-backfill rows; backfill_tournament_created_at
        // populates them separately).
        state: "Finished",
        special: false,
        created_at: String(r[9] ?? ""),
      },
    });
  }

  const entries: EntryRow[] = [];
  for (let i = 1; i < eRows.length; i++) {
    const r = eRows[i];
    if (!r || !r[0]) continue;
    entries.push({
      sheetRow: i + 1,
      entry: {
        id: String(r[0]),
        tournament_id: String(r[1] ?? ""),
        player_id: String(r[2] ?? ""),
        buy_ins: Number(r[3] ?? 0),
        finish_position: r[4] === "" || r[4] == null ? null : Number(r[4]),
        payout_override: r[5] === "" || r[5] == null ? null : Number(r[5]),
      },
    });
  }

  console.log(`Loaded ${tournaments.length} tournaments, ${entries.length} entries.`);

  // Group entries by tournament
  const entriesByT = new Map<string, EntryRow[]>();
  for (const er of entries) {
    if (!entriesByT.has(er.entry.tournament_id)) entriesByT.set(er.entry.tournament_id, []);
    entriesByT.get(er.entry.tournament_id)!.push(er);
  }

  // Plan changes
  type TournamentUpdate = { row: number; values: any[] };
  type EntryUpdate = { row: number; finish_position: number | null; payout_override: null };
  const tournamentUpdates: TournamentUpdate[] = [];
  const entryUpdates: EntryUpdate[] = [];

  let scanned = 0;
  let skipped_notLegacy = 0;
  let skipped_noEntries = 0;
  let skipped_noPool = 0;
  let skipped_noWinners = 0;
  let updated = 0;
  const warnings: string[] = [];

  // Sort by date for nicer logs
  const sortedT = [...tournaments].sort((a, b) =>
    a.tournament.date < b.tournament.date ? -1 : a.tournament.date > b.tournament.date ? 1 : 0,
  );

  for (const tr of sortedT) {
    scanned++;
    const t = tr.tournament;
    const isLegacyNote = (t.notes ?? "").toLowerCase().includes("imported from legacy");
    const isPlaceholderStructure =
      Array.isArray(t.payout_structure) &&
      t.payout_structure.length === 1 &&
      t.payout_structure[0].position === 1 &&
      nearlyEqual(t.payout_structure[0].pct, 100);
    if (!isLegacyNote || !isPlaceholderStructure) {
      skipped_notLegacy++;
      continue;
    }

    const ers = entriesByT.get(t.id) ?? [];
    if (ers.length === 0) {
      skipped_noEntries++;
      continue;
    }

    const totalPool = ers.reduce((s, er) => s + er.entry.buy_ins * t.buy_in_amount, 0);
    if (totalPool <= 0) {
      skipped_noPool++;
      continue;
    }

    // Winners: payout_override > 0.005 (avoid float noise around 0)
    const winners = ers
      .filter(er => (er.entry.payout_override ?? 0) > 0.005)
      .sort((a, b) => (b.entry.payout_override ?? 0) - (a.entry.payout_override ?? 0));

    if (winners.length === 0) {
      skipped_noWinners++;
      continue;
    }

    const payouts = winners.map(w => w.entry.payout_override!);
    const sumPayouts = payouts.reduce((s, x) => s + x, 0);

    // Sanity: zero-sum poker means sumPayouts ≈ totalPool. Anything else is data noise.
    if (!nearlyEqual(sumPayouts, totalPool, 0.5)) {
      warnings.push(
        `  ⚠ ${t.date} ${t.name}: payouts sum €${sumPayouts.toFixed(2)} ≠ pool €${totalPool.toFixed(2)} (Δ ${(sumPayouts - totalPool).toFixed(2)})`,
      );
    }

    // Use totalPool as the denominator so the new pcts replicate the original
    // payouts exactly when applied. The last slot is nudged to make pcts sum to 100.
    const newStructure = inferStructure(payouts, totalPool);

    tournamentUpdates.push({
      row: tr.sheetRow,
      values: [
        t.id, t.date, t.name, t.buy_in_amount,
        JSON.stringify(newStructure),
        t.notes ?? "",
      ],
    });

    // Winners get finish_position = rank; everyone gets payout_override cleared.
    const winnerIds = new Set(winners.map(w => w.entry.id));
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      entryUpdates.push({
        row: w.sheetRow,
        finish_position: i + 1,
        payout_override: null,
      });
    }
    for (const er of ers) {
      if (winnerIds.has(er.entry.id)) continue;
      entryUpdates.push({
        row: er.sheetRow,
        finish_position: null,
        payout_override: null,
      });
    }

    updated++;
    const structLog = newStructure.map(s => `${s.position}:${s.pct}%`).join(", ");
    console.log(
      `✓ ${t.date} ${t.name.padEnd(10)} pool=€${totalPool.toFixed(0).padStart(4)}  winners=${winners.length}  → [${structLog}]`,
    );
  }

  if (warnings.length) {
    console.log("\nWarnings (sum of payouts ≠ pool — kept original payouts via totalPool denominator):");
    for (const w of warnings) console.log(w);
  }

  console.log("\nSummary:");
  console.log(`  scanned         ${scanned}`);
  console.log(`  will update     ${updated}`);
  console.log(`  skip non-legacy ${skipped_notLegacy}`);
  console.log(`  skip no-entries ${skipped_noEntries}`);
  console.log(`  skip zero-pool  ${skipped_noPool}`);
  console.log(`  skip no-winners ${skipped_noWinners}`);
  console.log(`  tournament rows to write: ${tournamentUpdates.length}`);
  console.log(`  entry rows to write:      ${entryUpdates.length}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write changes.");
    return;
  }

  if (tournamentUpdates.length === 0 && entryUpdates.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  console.log("\nWriting changes…");

  // Build batchUpdate payloads. We rewrite full rows to keep the order of columns
  // aligned with the sheet headers (id, …, payout_structure, notes for Tournaments;
  // id, …, finish_position, payout_override for Entries).
  // Note: we need the full row for Entries too because partial writes still need to
  // not blank other columns — but updating columns E:F (finish_position, payout_override)
  // is sufficient and much smaller. Let's do that.

  const tData = tournamentUpdates.map(u => ({
    range: `Tournaments!A${u.row}:F${u.row}`,
    values: [u.values],
  }));

  const eData = entryUpdates.map(u => ({
    range: `Entries!E${u.row}:F${u.row}`,
    values: [[
      u.finish_position ?? "",
      u.payout_override ?? "",
    ]],
  }));

  // batchUpdate accepts many ranges in one call. Chunk to keep requests <~10k cells.
  async function batchWrite(data: { range: string; values: any[][] }[]) {
    const CHUNK = 200;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: "RAW", data: slice },
      });
      console.log(`  ✓ wrote ${slice.length} ranges (${i + slice.length}/${data.length})`);
    }
  }

  if (tData.length) {
    console.log(`Updating ${tData.length} tournament rows…`);
    await batchWrite(tData);
  }
  if (eData.length) {
    console.log(`Updating ${eData.length} entry rows (cols E:F)…`);
    await batchWrite(eData);
  }

  console.log("\n✓ Backfill complete.");
}

main().catch(err => {
  console.error("✗ Backfill failed:", err);
  process.exit(1);
});
