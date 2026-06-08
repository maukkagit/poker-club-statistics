/**
 * Merge the two "Roope Kirjokansi" location rows into one.
 *
 * Winner: "Roope (Kirjokansi 1 A Iso Omena)"  (id 0a51e1dd-…)
 *   — matches the dominant "<short host> (<address>)" naming convention
 *     used everywhere else in the sheet.
 * Loser:  "Roope Rättö Kirjokansi 1 A (Iso Omena)"  (id c7fa23ca-…)
 *
 * For each tournament currently pointing at the loser, repoint to the
 * winner; then delete the loser row.
 *
 *   npx tsx scripts/merge_kirjokansi.ts            # dry-run
 *   npx tsx scripts/merge_kirjokansi.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const WINNER_NAME = "Roope (Kirjokansi 1 A Iso Omena)";
const LOSER_NAME = "Roope Rättö Kirjokansi 1 A (Iso Omena)";
const SLEEP_MS = 2500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s: string) =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function main() {
  const sheets = await import("../lib/sheets");
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN"}`);

  const [tournaments, locations] = await Promise.all([
    sheets.listTournaments(),
    sheets.listLocations(),
  ]);
  const winner = locations.find(l => norm(l.name) === norm(WINNER_NAME));
  const loser = locations.find(l => norm(l.name) === norm(LOSER_NAME));
  if (!winner) throw new Error(`Winner location not found: "${WINNER_NAME}"`);
  if (!loser) {
    console.log(`Loser location "${LOSER_NAME}" not present — nothing to merge.`);
    return;
  }
  console.log(`  winner: "${winner.name}" id=${winner.id}`);
  console.log(`  loser:  "${loser.name}" id=${loser.id}`);

  const moves = tournaments.filter(t => t.location_id === loser.id);
  console.log(`\nTournaments to repoint: ${moves.length}`);
  for (const t of moves) {
    console.log(`  ~ ${t.date}  id=${t.id.slice(0, 8)}  name="${t.name || "(no name)"}"`);
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write.");
    return;
  }

  for (const t of moves) {
    await sheets.updateTournament({ ...t, location_id: winner.id });
    console.log(`  ✓ repointed ${t.date} → ${winner.name}`);
    await sleep(SLEEP_MS);
  }

  // deleteLocation refuses if any tournament still references it — so this
  // doubles as a safety check that the repoint succeeded.
  await sheets.deleteLocation(loser.id);
  console.log(`  ✓ deleted "${loser.name}" (id=${loser.id})`);
}

main().catch(e => { console.error(e); process.exit(1); });
