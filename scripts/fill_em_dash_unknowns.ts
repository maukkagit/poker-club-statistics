/**
 * Fill in the remaining "unknown" tournaments (those still pointing at the
 * "—" placeholder location) using `location_suggestions.json` from the
 * chat analysis.
 *
 * For each tournament currently on the "—" placeholder:
 *   - Look up its date in the suggestions sidecar.
 *   - If there's a non-null suggested label:
 *       - Resolve / create the matching Location row.
 *       - Repoint the tournament at it.
 *   - Otherwise leave it alone.
 *
 * Idempotent. Default is dry-run.
 *
 *   npx tsx scripts/fill_em_dash_unknowns.ts            # dry-run
 *   npx tsx scripts/fill_em_dash_unknowns.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const PLACEHOLDER_NAME = "—"; // em dash
const SUGGESTIONS_PATH = path.resolve(process.cwd(), "scripts/location_suggestions.json");
const SLEEP_MS = 2500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s: string) =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Suggestion = { label: string | null; confidence: string };
type SuggestionsByDate = Record<string, Suggestion>;

// The suggestions JSON predates the canonical naming convention now in
// the sheet (<short host> (<address>)). Map the older labels onto the
// existing Location rows so we don't create duplicate rows.
const LABEL_ALIASES: Record<string, string> = {
  "Amos Aaltio Perustie 19 A": "Ami (Perustie 19 A)",
  "Jamiro Lilja Rudolfintie 14 C": "Jamppa (Rudolfintie 14 C)",
  "Juho's parents Runeberginkatu 32": "Donin porukat (Runeberginkatu 32)",
};
function canonicalLabel(raw: string): string {
  return LABEL_ALIASES[raw] ?? raw;
}

async function main() {
  const sheets = await import("../lib/sheets");
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN"}`);

  if (!fs.existsSync(SUGGESTIONS_PATH)) {
    throw new Error(`Missing ${SUGGESTIONS_PATH}`);
  }
  const suggestions: SuggestionsByDate = JSON.parse(
    fs.readFileSync(SUGGESTIONS_PATH, "utf8"),
  );

  const [tournaments, locations] = await Promise.all([
    sheets.listTournaments(),
    sheets.listLocations(),
  ]);
  const orderById = sheets.computeTournamentOrderNumbers(tournaments);

  const placeholder = locations.find(l => norm(l.name) === norm(PLACEHOLDER_NAME));
  if (!placeholder) {
    console.log(`  ! placeholder "${PLACEHOLDER_NAME}" not found — nothing to fill.`);
    return;
  }
  console.log(`  ✓ placeholder "${PLACEHOLDER_NAME}" id=${placeholder.id}`);

  const locByNormName = new Map(locations.map(l => [norm(l.name), l]));

  const unknownT = tournaments.filter(t => t.location_id === placeholder.id);
  console.log(`\n${unknownT.length} tournament(s) currently on "${PLACEHOLDER_NAME}":`);

  type Plan = { tournamentId: string; date: string; displayName: string; label: string; confidence: string };
  const plans: Plan[] = [];
  const leaveAlone: { date: string; displayName: string; reason: string }[] = [];

  for (const t of unknownT) {
    const displayName = sheets.displayTournamentName({
      name: t.name,
      order_number: orderById.get(t.id) ?? null,
      state: t.state,
    });
    const s = suggestions[t.date];
    if (!s || !s.label) {
      leaveAlone.push({
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
      label: canonicalLabel(s.label),
      confidence: s.confidence,
    });
  }

  const labelsNeeded = Array.from(new Set(plans.map(p => p.label)));
  const labelsToCreate = labelsNeeded.filter(l => !locByNormName.has(norm(l)));

  console.log(`\nLabels in plan: ${labelsNeeded.length} (${labelsToCreate.length} new, ${labelsNeeded.length - labelsToCreate.length} reuse existing)`);
  for (const l of labelsToCreate) console.log(`  + would create "${l}"`);

  console.log(`\nReassign plan (${plans.length} tournaments):`);
  for (const p of plans) {
    const tag = p.confidence === "high" ? "  " : ` ${p.confidence[0].toUpperCase()}`;
    console.log(`  ${tag} ${p.date}  ${p.displayName.padEnd(28)} → ${p.label}`);
  }

  if (leaveAlone.length) {
    console.log(`\nLeaving ${leaveAlone.length} tournament(s) on "${PLACEHOLDER_NAME}" (no chat data):`);
    for (const s of leaveAlone) {
      console.log(`  - ${s.date}  ${s.displayName.padEnd(28)} (${s.reason})`);
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write.");
    return;
  }
  if (plans.length === 0 && labelsToCreate.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  for (const l of labelsToCreate) {
    const created = await sheets.createLocation(l);
    locByNormName.set(norm(created.name), created);
    console.log(`  + created location "${created.name}" (id=${created.id})`);
    await sleep(SLEEP_MS);
  }

  const fresh = await sheets.listTournaments();
  const freshById = new Map(fresh.map(t => [t.id, t]));

  let done = 0;
  for (const p of plans) {
    const loc = locByNormName.get(norm(p.label));
    if (!loc) throw new Error(`Location resolution failed for "${p.label}"`);
    const t = freshById.get(p.tournamentId);
    if (!t) {
      console.warn(`  ! tournament ${p.tournamentId} disappeared — skipping`);
      continue;
    }
    if (t.location_id !== placeholder.id) {
      console.warn(`  ! ${t.date} ${p.displayName} no longer on placeholder — skipping`);
      continue;
    }
    await sheets.updateTournament({ ...t, location_id: loc.id });
    done += 1;
    console.log(`  ✓ ${t.date} → ${loc.name} (${done}/${plans.length})`);
    await sleep(SLEEP_MS);
  }

  console.log("\n✓ Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
