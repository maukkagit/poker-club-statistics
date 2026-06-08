/**
 * Repoint the 3 tournaments whose location_id was orphaned (their previous
 * Location row was deleted during manual cleanup) to the existing
 * "Roope (Tornitaso 1 Tapiola)" row.
 *
 * Idempotent: skips tournaments that already point at the target.
 *
 *   npx tsx scripts/fix_dangling_roope.ts            # dry-run
 *   npx tsx scripts/fix_dangling_roope.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const TARGET_NAME = "Roope (Tornitaso 1 Tapiola)";
const DATES = ["2023-07-22", "2023-09-02", "2023-10-21"];
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
  const byLocId = new Map(locations.map(l => [l.id, l]));

  let target = locations.find(l => norm(l.name) === norm(TARGET_NAME));
  if (!target) {
    if (!APPLY) {
      console.log(`  + would create location "${TARGET_NAME}"`);
    } else {
      target = await sheets.createLocation(TARGET_NAME);
      console.log(`  + created location "${target.name}" (id=${target.id})`);
      await sleep(SLEEP_MS);
    }
  } else {
    console.log(`  ✓ target location exists: "${target.name}" id=${target.id}`);
  }

  const targets = tournaments.filter(t => DATES.includes(t.date));
  if (targets.length === 0) {
    console.log("  ! No tournaments found for the listed dates.");
    return;
  }

  for (const t of targets) {
    const cur = byLocId.get(t.location_id ?? "");
    const curLabel = cur ? `"${cur.name}"` : `<missing ${t.location_id}>`;
    if (target && t.location_id === target.id) {
      console.log(`  = ${t.date}  already on target`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ~ ${t.date}  ${curLabel} → "${TARGET_NAME}"`);
      continue;
    }
    if (!target) throw new Error("target should exist by apply phase");
    await sheets.updateTournament({ ...t, location_id: target.id });
    console.log(`  ✓ ${t.date}  ${curLabel} → "${target.name}"`);
    await sleep(SLEEP_MS);
  }

  if (!APPLY) console.log("\nDry-run only. Re-run with `-- --apply` to write.");
}

main().catch(e => { console.error(e); process.exit(1); });
