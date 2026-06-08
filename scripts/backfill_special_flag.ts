/**
 * Flip `special = true` on the 5 tournaments that came from
 * `legacy_files/Special tournament stats.pdf` (imported by
 * `scripts/import_special_tournaments.ts`).
 *
 * Identifying the 5 rows by their (date, name) tuple is robust: the import
 * script uses those exact names verbatim, and nothing else in the sheet
 * matches them.
 *
 * Also rewrites the Tournaments header so the new "special" column shows
 * up in the spreadsheet UI. `ensureSchema` does this automatically on
 * boot, but we call it here so a one-off script run is self-sufficient.
 *
 * Idempotent. Default is dry-run.
 *
 *   npx tsx scripts/backfill_special_flag.ts            # dry-run
 *   npx tsx scripts/backfill_special_flag.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const SLEEP_MS = 2500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s: string) =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Each (date, name) tuple from the import script — these are the only
// rows that should get `special = true`.
const SPECIALS: Array<{ date: string; name: string }> = [
  { date: "2024-04-20", name: "2024 NLH Showdown" },
  { date: "2024-12-28", name: "2024 NLH 6-Max Winter Classic" },
  { date: "2025-05-17", name: "2025 NLH 6-Max Spring Showdown" },
  { date: "2025-09-13", name: "2025 NLH 6-Max Autumn Open" },
  { date: "2026-02-28", name: "2026 NLH 6-Max Winter Classic" },
];

async function main() {
  const sheets = await import("../lib/sheets");
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN"}`);

  if (APPLY) {
    // Make sure the new `special` column is present in the header row
    // before we start writing values into it. ensureSchema is idempotent
    // — a no-op when the header is already correct.
    await sheets.ensureSchema();
  }

  const tournaments = await sheets.listTournaments();

  type Plan = { id: string; date: string; name: string; alreadySpecial: boolean };
  const plans: Plan[] = [];
  for (const target of SPECIALS) {
    const matches = tournaments.filter(
      t => t.date === target.date && norm(t.name) === norm(target.name),
    );
    if (matches.length === 0) {
      console.warn(`  ! no match for ${target.date} "${target.name}" — skipping`);
      continue;
    }
    if (matches.length > 1) {
      console.warn(`  ! ${matches.length} matches for ${target.date} "${target.name}" — flagging ALL`);
    }
    for (const t of matches) {
      plans.push({
        id: t.id,
        date: t.date,
        name: t.name,
        alreadySpecial: t.special === true,
      });
    }
  }

  const toUpdate = plans.filter(p => !p.alreadySpecial);
  const alreadySet = plans.filter(p => p.alreadySpecial);

  console.log(`\nPlan: ${plans.length} matched, ${toUpdate.length} need flipping, ${alreadySet.length} already special.`);
  for (const p of plans) {
    const tag = p.alreadySpecial ? "= " : "+ ";
    console.log(`  ${tag} ${p.date}  "${p.name}"  id=${p.id.slice(0, 8)}`);
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write.");
    return;
  }
  if (toUpdate.length === 0) {
    console.log("\nNothing to write — all targets already flagged.");
    return;
  }

  // Re-read fresh state so we don't clobber any other column the user may
  // have touched between the listTournaments() above and now.
  const fresh = await sheets.listTournaments();
  const freshById = new Map(fresh.map(t => [t.id, t]));

  let done = 0;
  for (const p of toUpdate) {
    const t = freshById.get(p.id);
    if (!t) {
      console.warn(`  ! ${p.id.slice(0, 8)} disappeared from sheet — skipping`);
      continue;
    }
    await sheets.updateTournament({ ...t, special: true });
    done += 1;
    console.log(`  ✓ flagged ${p.date} "${p.name}" (${done}/${toUpdate.length})`);
    await sleep(SLEEP_MS);
  }
  console.log("\n✓ Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
