/**
 * Backfill real locations onto every tournament currently pointing at the
 * "[unknown]" sentinel, using the per-date mapping inferred from the
 * WhatsApp chat (see `scripts/location_suggestions.py` for the source of
 * truth and `scripts/location_suggestions.json` for the JSON sidecar this
 * script consumes).
 *
 * For each tournament whose `location_id` currently points at the
 * "[unknown]" sentinel:
 *   - Look up the suggested label by tournament date.
 *   - Ensure a Location row exists for that label (creates one if needed,
 *     using sheets.createLocation's case-insensitive dedup).
 *   - Reassign the tournament's `location_id` to that row.
 *
 * Dates without a suggestion (label === null in the JSON) are left alone —
 * those are the ones marked "unknown" in the suggestions and need a human
 * decision.
 *
 * Tournaments that already point at a real (non-sentinel) location are
 * never touched, even if their date matches a suggestion. The script is
 * strictly additive: it only fills in the blanks.
 *
 * Default mode is DRY-RUN. Pass `--apply` to write changes.
 *
 * Run:
 *   npx tsx scripts/backfill-locations-from-chat.ts            # dry-run
 *   npx tsx scripts/backfill-locations-from-chat.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const SENTINEL_NAME = "[unknown]";
const SUGGESTIONS_PATH = path.resolve(process.cwd(), "scripts/location_suggestions.json");

type Suggestion = { label: string | null; confidence: string };
type SuggestionsByDate = Record<string, Suggestion>;

const norm = (s: string) =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Sheets API has 60 read req/min per user (default project quota). Every
// updateTournament call internally does a findRowIndex (= 1 read) before
// writing, so the bottleneck is reads, not writes. Pace at ~25 reqs/min
// to leave headroom for parallel UI traffic.
const SLEEP_MS = 2500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const sheets = await import("../lib/sheets");

  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);

  if (!fs.existsSync(SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing ${SUGGESTIONS_PATH}. Run \`python3 scripts/location_suggestions.py --json\` first.`,
    );
  }
  const suggestions: SuggestionsByDate = JSON.parse(
    fs.readFileSync(SUGGESTIONS_PATH, "utf8"),
  );

  console.log("\nLoading sheet state…");
  const [allTournaments, allLocations] = await Promise.all([
    sheets.listTournaments(),
    sheets.listLocations(),
  ]);
  const orderById = sheets.computeTournamentOrderNumbers(allTournaments);

  const sentinel = allLocations.find(l => norm(l.name) === norm(SENTINEL_NAME));
  if (!sentinel) {
    console.log(
      `  ! "${SENTINEL_NAME}" location not found — nothing currently points to the sentinel.`,
    );
    console.log("  Have you run backfill-unknown-location first?");
    return;
  }
  console.log(`  ✓ sentinel "${SENTINEL_NAME}" id=${sentinel.id}`);

  // Index existing locations by normalised name for O(1) "do we already
  // have this?" lookups while we walk the suggestions.
  const locByNormName = new Map(allLocations.map(l => [norm(l.name), l]));

  // First pass: collect every unique label that's actually needed —
  // i.e. labels for tournaments that currently sit at the sentinel AND
  // have a suggestion. Avoids creating Location rows for dates that
  // won't end up being touched.
  const unknownTournaments = allTournaments.filter(
    t => t.location_id === sentinel.id,
  );
  console.log(
    `\n${unknownTournaments.length} tournament(s) currently point at "${SENTINEL_NAME}".`,
  );

  type Plan = {
    tournamentId: string;
    date: string;
    displayName: string;
    label: string;
    confidence: string;
  };
  const plans: Plan[] = [];
  const skipped: { date: string; displayName: string; reason: string }[] = [];
  for (const t of unknownTournaments) {
    const displayName = sheets.displayTournamentName({
      name: t.name,
      order_number: orderById.get(t.id) ?? null,
      state: t.state,
    });
    const s = suggestions[t.date];
    if (!s || !s.label) {
      skipped.push({
        date: t.date,
        displayName,
        reason: s ? `no label (confidence=${s.confidence})` : "no suggestion entry",
      });
      continue;
    }
    plans.push({
      tournamentId: t.id,
      date: t.date,
      displayName,
      label: s.label,
      confidence: s.confidence,
    });
  }

  // Figure out which new location names we'll need to create.
  const labelsNeeded = Array.from(new Set(plans.map(p => p.label)));
  const labelsToCreate = labelsNeeded.filter(l => !locByNormName.has(norm(l)));

  console.log(
    `\nLabels in plan: ${labelsNeeded.length} (${labelsToCreate.length} new, ${labelsNeeded.length - labelsToCreate.length} reuse existing)`,
  );
  if (labelsToCreate.length) {
    for (const l of labelsToCreate) console.log(`  + would create "${l}"`);
  }

  console.log(`\nReassign plan (${plans.length} tournaments):`);
  for (const p of plans) {
    const tag = p.confidence === "high" ? "  " : ` ${p.confidence[0].toUpperCase()}`;
    console.log(`  ${tag} ${p.date}  ${p.displayName.padEnd(28)} → ${p.label}`);
  }

  if (skipped.length) {
    console.log(`\nLeaving ${skipped.length} tournament(s) on "${SENTINEL_NAME}" (no suggestion):`);
    for (const s of skipped) {
      console.log(`  - ${s.date}  ${s.displayName.padEnd(28)} (${s.reason})`);
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write changes.");
    return;
  }
  if (plans.length === 0 && labelsToCreate.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  // ----- WRITE PHASE -----

  // 1. Create any missing Location rows. We re-resolve via createLocation
  //    which is idempotent (case-insensitive dedup), so a half-finished
  //    previous run won't produce duplicates.
  for (const l of labelsToCreate) {
    const created = await sheets.createLocation(l);
    locByNormName.set(norm(created.name), created);
    console.log(`  + created location "${created.name}" (id=${created.id})`);
    await sleep(SLEEP_MS);
  }

  // 2. Reassign each tournament. Re-read tournaments freshly so we have
  //    the latest row state (in case the user is poking at the sheet in
  //    parallel). updateTournament is whole-row replace so we have to
  //    preserve every other field.
  const fresh = await sheets.listTournaments();
  const freshById = new Map(fresh.map(t => [t.id, t]));

  let done = 0;
  for (const p of plans) {
    const loc = locByNormName.get(norm(p.label));
    if (!loc) {
      throw new Error(`Location resolution failed for "${p.label}" — aborting.`);
    }
    const t = freshById.get(p.tournamentId);
    if (!t) {
      console.warn(`  ! tournament ${p.tournamentId} disappeared from sheet — skipping`);
      continue;
    }
    // Defensive: don't overwrite if someone else already moved this row
    // off the sentinel since we read it.
    if (t.location_id !== sentinel.id) {
      console.warn(
        `  ! ${t.date} ${p.displayName} already points elsewhere (${t.location_id}) — skipping`,
      );
      continue;
    }
    await sheets.updateTournament({ ...t, location_id: loc.id });
    done += 1;
    if (done % 5 === 0 || done === plans.length) {
      console.log(`  ✓ wrote ${done}/${plans.length}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log("\n✓ Backfill complete.");
}

main().catch(err => {
  console.error("✗ Backfill failed:", err);
  process.exit(1);
});
