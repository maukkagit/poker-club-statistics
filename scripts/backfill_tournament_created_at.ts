/**
 * Backfill the new `created_at` column on the Tournaments tab for every
 * legacy row that doesn't have one. Rows are processed in current sheet
 * order so that, after the backfill, the existing visible ordering on the
 * dashboard and tournaments list is preserved exactly.
 *
 * Within a date group (multiple rows sharing the same `date`), each row
 * gets `${date}T12:00:SS.000Z` where SS counts DOWN as you move down the
 * sheet — so the earliest sheet row gets the latest created_at within the
 * date, and the new `(date desc, created_at desc)` sort yields the same
 * order the user has been seeing.
 *
 * Idempotent. Default is dry-run.
 *
 *   npx tsx scripts/backfill_tournament_created_at.ts            # dry-run
 *   npx tsx scripts/backfill_tournament_created_at.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * `secsAfterMidnight` ∈ [0, 86399]. Returned as HH:MM:SS. We anchor on
 * 12:00:00 and walk forward in seconds, so a date group of n rows uses
 * times in `[12:00:00 + 0, 12:00:00 + n-1]`. Even a hypothetical date
 * with 40 000 rows would stay safely under 23:59:59.
 */
function toHHMMSS(secsAfterMidnight: number): string {
  const h = Math.floor(secsAfterMidnight / 3600);
  const m = Math.floor((secsAfterMidnight % 3600) / 60);
  const s = secsAfterMidnight % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

async function main() {
  const sheets = await import("../lib/sheets");
  const { google } = await import("googleapis");

  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN"}`);

  // Make sure the header row includes `created_at` so the value we write
  // into column J ends up under the right label in Sheets. ensureSchema is
  // idempotent — a no-op when the header is already correct.
  if (APPLY) await sheets.ensureSchema();

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) {
    console.error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SHEET_ID");
    process.exit(1);
  }
  const auth = new google.auth.JWT({
    email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const api = google.sheets({ version: "v4", auth });

  const res = await api.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `Tournaments!A1:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = (res.data.values ?? []) as any[][];
  if (rows.length <= 1) {
    console.log("Tournaments tab is empty — nothing to do.");
    return;
  }
  const header = rows[0].map(String);
  const dateCol = header.indexOf("date");
  if (dateCol < 0) {
    console.error("Tournaments tab is missing the `date` column.");
    console.error(`Header: ${JSON.stringify(header)}`);
    process.exit(1);
  }
  // The `created_at` column may not exist yet — ensureSchema will add it
  // before we write. For the dry-run preview, fall back to the canonical
  // position from the TS schema so users can see what would be written
  // without us having to mutate the header row in dry-run mode.
  let createdCol = header.indexOf("created_at");
  if (createdCol < 0) {
    createdCol = sheets.TABS.Tournaments.header.indexOf("created_at");
    console.log(
      `(no created_at column yet — would be added at position ${createdCol + 1} on apply)`,
    );
  }

  // Walk the sheet in row order, grouped by date. For each date we
  // remember the rows-in-this-date so we can later allocate descending
  // timestamps within the group (oldest sheet row gets the latest time).
  type Row = { sheetRow: number; date: string; existingCreated: string };
  const missingByDate = new Map<string, Row[]>();
  let totalRows = 0;
  let alreadySet = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue; // skip blank lines
    totalRows += 1;
    const date = String(r[dateCol] ?? "");
    const existing = String(r[createdCol] ?? "");
    if (existing.trim()) {
      alreadySet += 1;
      continue;
    }
    if (!date) {
      console.warn(`  ! row ${i + 1} has no date — skipping created_at backfill`);
      continue;
    }
    if (!missingByDate.has(date)) missingByDate.set(date, []);
    missingByDate.get(date)!.push({ sheetRow: i + 1, date, existingCreated: existing });
  }

  // Build the column letter for `created_at` (1-based A=1). For our schema
  // (10 columns, created_at last) this is "J", but the helper means we
  // won't silently break if the schema grows.
  function colLetter(n: number): string {
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  const createdLetter = colLetter(createdCol + 1);

  type Update = { range: string; values: any[][] };
  const updates: Update[] = [];
  for (const [date, group] of missingByDate) {
    // Sheet rows are appended-only here, so the order in `group` is the
    // order they appear in the sheet (top → bottom). Assign descending
    // times: earliest sheet row in the date group gets the LATEST
    // created_at, so when we sort by (date desc, created_at desc) the
    // current visible order is preserved.
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const secs = n - 1 - i; // 0 for the last sheet row, n-1 for the first
      const created = `${date}T${toHHMMSS(43200 + secs)}.000Z`;
      updates.push({
        range: `Tournaments!${createdLetter}${group[i].sheetRow}`,
        values: [[created]],
      });
    }
  }

  console.log(`\nTournament rows scanned: ${totalRows}`);
  console.log(`  already have created_at: ${alreadySet}`);
  console.log(`  will backfill:           ${updates.length}`);
  const sampleSize = Math.min(updates.length, 5);
  if (sampleSize > 0) {
    console.log(`\nFirst ${sampleSize} planned writes:`);
    for (let i = 0; i < sampleSize; i++) {
      console.log(`  ${updates[i].range} = ${updates[i].values[0][0]}`);
    }
  }
  // For every date with >1 row, dump the full set of planned writes so the
  // operator can sanity-check that the same-day tiebreaker matches the
  // current visible order before applying.
  const dupDates = [...missingByDate.entries()].filter(([, g]) => g.length > 1);
  if (dupDates.length > 0) {
    console.log(`\nSame-day tiebreakers (${dupDates.length} dates with >1 row):`);
    for (const [date, group] of dupDates) {
      console.log(`  ${date}:`);
      const n = group.length;
      for (let i = 0; i < n; i++) {
        const secs = n - 1 - i;
        const created = `${date}T${toHHMMSS(43200 + secs)}.000Z`;
        console.log(`    row ${group[i].sheetRow} → ${created}`);
      }
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write changes.");
    return;
  }
  if (updates.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  // batchUpdate handles many ranges in a single API call. Chunk to keep
  // requests well under the per-request size limit.
  console.log("\nWriting changes…");
  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: slice },
    });
    console.log(`  ✓ wrote ${slice.length} ranges (${i + slice.length}/${updates.length})`);
  }
  console.log("\n✓ Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
