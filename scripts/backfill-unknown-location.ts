/**
 * Backfill an "[unknown]" location for tournaments that were created before
 * locations were a required field. We can't enforce the "location is
 * mandatory" rule on existing legacy rows without first giving them
 * *something*, so this script:
 *
 *   1. Ensures a single sentinel location named "[unknown]" exists
 *      (idempotent — uses `createLocation`'s built-in case-insensitive
 *      dedup so re-runs always find the same row).
 *   2. Finds every tournament whose `location_id` is null/empty.
 *   3. Updates each one to point at the sentinel location.
 *
 * Default mode is DRY-RUN. Pass `--apply` to write changes.
 *
 * Run:
 *   npm run backfill-unknown-location            # dry-run, prints plan
 *   npm run backfill-unknown-location -- --apply # writes changes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const SENTINEL_NAME = "[unknown]";

async function main() {
  // Lazy-import so loadEnvConfig has populated process.env before
  // lib/sheets.ts reads its env vars at module init.
  const sheets = await import("../lib/sheets");

  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);

  console.log(`\nEnsuring "${SENTINEL_NAME}" location exists…`);
  // createLocation is idempotent via case-insensitive name match, so calling
  // it whether or not the row already exists is safe. We do call it
  // unconditionally in --apply mode but skip the write in dry-run so a dry
  // preview doesn't leave a stub row behind.
  const existingLocations = await sheets.listLocations();
  const norm = (s: string) =>
    s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let sentinel = existingLocations.find(l => norm(l.name) === norm(SENTINEL_NAME)) ?? null;
  if (sentinel) {
    console.log(`  ✓ already exists (id=${sentinel.id})`);
  } else if (!APPLY) {
    console.log(`  + would create "${SENTINEL_NAME}" location`);
  } else {
    sentinel = await sheets.createLocation(SENTINEL_NAME);
    console.log(`  ✓ created (id=${sentinel.id})`);
  }

  console.log("\nScanning tournaments…");
  const tournaments = await sheets.listTournaments();
  const missing = tournaments.filter(
    t => !t.location_id || !String(t.location_id).trim(),
  );
  console.log(`  ${tournaments.length} total, ${missing.length} missing a location.`);

  if (missing.length === 0) {
    console.log("\nNothing to backfill.");
    return;
  }

  // Show what we'd touch — date + name (or a "Tournament #N" placeholder
  // computed from the same chronological order helper the app uses) so
  // the log lines up visually with the UI.
  const orderById = sheets.computeTournamentOrderNumbers(tournaments);
  for (const t of missing) {
    const label = sheets.displayTournamentName({
      name: t.name,
      order_number: orderById.get(t.id) ?? null,
    });
    console.log(`  • ${t.date}  ${label}`);
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write changes.");
    return;
  }

  if (!sentinel) {
    throw new Error("Sentinel location resolution failed — refusing to write.");
  }

  console.log(`\nAssigning ${missing.length} tournaments to "${SENTINEL_NAME}"…`);
  let done = 0;
  for (const t of missing) {
    await sheets.updateTournament({ ...t, location_id: sentinel.id });
    done++;
    if (done % 10 === 0 || done === missing.length) {
      console.log(`  ✓ wrote ${done}/${missing.length}`);
    }
  }
  console.log("\n✓ Backfill complete.");
}

main().catch(err => {
  console.error("✗ Backfill failed:", err);
  process.exit(1);
});
