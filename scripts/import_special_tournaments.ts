/**
 * Import the 5 "Special tournaments" documented in
 * `legacy_files/Special tournament stats.pdf`.
 *
 * For each tournament:
 *   - Ensure its Location row exists (creates if missing).
 *   - Ensure every player exists (creates missing ones).
 *   - Create the Tournament row in "Finished" state.
 *   - Create one Entry per player with the correct buy_ins (1 + #rebuys)
 *     and finish_position 1/2/3 for the medallists.
 *
 * Service fees are deliberately ignored (per user request).
 *
 * Default mode is DRY-RUN. Pass `--apply` to write.
 *
 *   npx tsx scripts/import_special_tournaments.ts            # dry-run
 *   npx tsx scripts/import_special_tournaments.ts -- --apply # writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const SLEEP_MS = 1200; // writes only — no read-per-write here, so this is purely conservative pacing.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s: string) =>
  s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

type Spec = {
  date: string;
  name: string;
  buyIn: number;
  payouts: [number, number, number]; // 1st/2nd/3rd pct
  locationLabel: string;
  results: { 1: string; 2: string; 3: string };
  // [player, rebuys]. buy_ins = 1 + rebuys.
  players: Array<[string, number]>;
};

const SPECIALS: Spec[] = [
  {
    date: "2024-04-20",
    name: "2024 NLH Showdown",
    buyIn: 20,
    payouts: [50, 30, 20],
    locationLabel: "Amin porukat (Niemenmäenkuja 1 B)",
    results: { 1: "Juho Korhonen", 2: "Otto von Boehm", 3: "Kalle Armanto" },
    players: [
      ["Aapo Pajunen", 0],
      ["Aleksi Järveläinen", 1],
      ["Amos Aaltio", 1],
      ["Artturi Jalli", 1],
      ["Atte Rouhe", 0],
      ["Jamiro Lilja", 0],
      ["Joonas Rasa", 1],
      ["Juho Korhonen", 0],
      ["Kalle Armanto", 0],
      ["Kasimir Palmula", 0],
      ["Lalli Nurmi", 0],
      ["Roope Rättö", 1],
      ["Sami Hätälä", 1],
      ["Tuomas Järvelä", 1],
      ["Vili Meriläinen", 1],
      ["Otto von Boehm", 1],
    ],
  },
  {
    date: "2024-12-28",
    name: "2024 NLH 6-Max Winter Classic",
    buyIn: 20,
    payouts: [55, 30, 15],
    locationLabel: "Amin porukat (Niemenmäenkuja 1 B)",
    results: { 1: "Jamiro Lilja", 2: "Kalle Armanto", 3: "Juho Korhonen" },
    players: [
      ["Amos Aaltio", 0],
      ["Jamiro Lilja", 0],
      ["Joonas Rasa", 0],
      ["Juho Korhonen", 0],
      ["Lalli Nurmi", 1],
      ["Roope Rättö", 0],
      ["Atte Rouhe", 0],
      ["Ilmari Lehtinen", 1],
      ["Kalle Armanto", 0],
      ["Mauno Malmivaara", 1],
      ["Samuli Laakko", 1],
      ["Tuomas Järvelä", 0],
      ["Aapo Pajunen", 1],
      ["Artturi Jalli", 1],
      ["Vilko Repo", 1],
      ["Kasimir Palmula", 0],
      ["Valtteri Kämäräinen", 1],
      ["Vili Meriläinen", 0],
    ],
  },
  {
    date: "2025-05-17",
    name: "2025 NLH 6-Max Spring Showdown",
    buyIn: 25,
    payouts: [58, 28, 14],
    locationLabel: "Amin porukat (Niemenmäenkuja 1 B)",
    results: { 1: "Vili Meriläinen", 2: "Roope Rättö", 3: "Juho Korhonen" },
    players: [
      // seat 12 was empty — skipped
      ["Amos Aaltio", 1],
      ["Jamiro Lilja", 0],
      ["Joonas Rasa", 1],
      ["Juho Korhonen", 1],
      ["Lalli Nurmi", 1],
      ["Roope Rättö", 1],
      ["Atte Rouhe", 1],
      ["Heikki Jalo", 1],
      ["Ilmari Lehtinen", 1],
      ["Johannes Jäämeri", 0],
      ["Kalle Armanto", 1],
      ["Artturi Jalli", 1],
      ["Kalle Hiltunen", 0],
      ["Tom Palamaa", 1],
      ["Touko Aroheikki", 0],
      ["Tresor Banzuzi", 0],
      ["Vili Meriläinen", 0],
    ],
  },
  {
    date: "2025-09-13",
    name: "2025 NLH 6-Max Autumn Open",
    buyIn: 25,
    payouts: [60, 25, 15],
    locationLabel: "Jallin toimisto (Tekniikantie 14)",
    results: { 1: "Vili Meriläinen", 2: "Samuli Laakko", 3: "Tuomas Järvelä" },
    players: [
      ["Aapo Pajunen", 2], // 50 / 25
      ["Amos Aaltio", 0],
      ["Artturi Jalli", 0],
      ["Eetu Kauppinen", 0],
      ["Ilmari Lehtinen", 4], // 100 / 25
      ["Jamiro Lilja", 0],
      ["Johannes Jäämeri", 0],
      ["Joonas Rasa", 2],
      ["Juho Korhonen", 1],
      ["Kalle Armanto", 4],
      ["Kasimir Palmula", 3], // 75 / 25
      ["Lalli Nurmi", 1],
      ["Samuli Laakko", 2],
      ["Tom Palamaa", 0],
      ["Tuomas Järvelä", 1],
      ["Vili Meriläinen", 0],
      ["Vilko Repo", 1],
      ["Ville Sihvola", 0],
    ],
  },
  {
    date: "2026-02-28",
    name: "2026 NLH 6-Max Winter Classic",
    buyIn: 25,
    payouts: [60, 25, 15],
    locationLabel: "Eetun luona (Pieni Roobertinkatu 4-6)",
    results: { 1: "Lalli Nurmi", 2: "Eetu Kauppinen", 3: "Mauno Malmivaara" },
    players: [
      ["Amos Aaltio", 2], // 50 / 25
      ["Eetu Kauppinen", 0],
      ["Joonas Rasa", 1],
      ["Mauno Malmivaara", 3], // 75 / 25
      ["Valtteri Kämäräinen", 2],
      ["Kalle Armanto", 2],
      ["Artturi Jalli", 0],
      ["Lalli Nurmi", 0],
      ["Atte Rouhe", 0],
      ["Samuli Laakko", 2],
      ["Ilmari Lehtinen", 1],
      ["Juho Korhonen", 0],
      ["Jamiro Lilja", 0],
      ["Kasimir Palmula", 1],
      ["Erik Kymäläinen", 2],
      ["Aapo Pajunen", 2],
      ["Tom Palamaa", 0],
      ["Otto von Boehm", 1],
    ],
  },
];

async function main() {
  const sheets = await import("../lib/sheets");
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN"}`);

  const [players, locations, tournaments] = await Promise.all([
    sheets.listPlayers(),
    sheets.listLocations(),
    sheets.listTournaments(),
  ]);

  const playerByNorm = new Map(players.map(p => [norm(p.name), p]));
  const locByNorm = new Map(locations.map(l => [norm(l.name), l]));

  // ----- Pre-flight: find missing players and locations -----
  const allPlayerNames = new Set<string>();
  const allLocationLabels = new Set<string>();
  for (const s of SPECIALS) {
    allLocationLabels.add(s.locationLabel);
    for (const [name] of s.players) allPlayerNames.add(name);
    for (const name of Object.values(s.results)) allPlayerNames.add(name);
  }

  const playersToCreate = [...allPlayerNames].filter(n => !playerByNorm.has(norm(n)));
  const locationsToCreate = [...allLocationLabels].filter(l => !locByNorm.has(norm(l)));

  console.log(`\nPlayers referenced: ${allPlayerNames.size}`);
  console.log(`  ${playersToCreate.length} to create:`);
  for (const n of playersToCreate.sort()) console.log(`    + ${n}`);

  console.log(`\nLocations referenced: ${allLocationLabels.size}`);
  console.log(`  ${locationsToCreate.length} to create:`);
  for (const l of locationsToCreate.sort()) console.log(`    + ${l}`);

  // ----- Pre-flight: confirm none of these tournaments already exists -----
  console.log(`\nTournaments to create:`);
  for (const s of SPECIALS) {
    const dup = tournaments.find(t => t.date === s.date && norm(t.name) === norm(s.name));
    const sumRebuys = s.players.reduce((a, [, r]) => a + r, 0);
    const totalBuyIns = s.players.length + sumRebuys;
    const pool = totalBuyIns * s.buyIn;
    console.log(
      `  ${dup ? "!" : "+"} ${s.date}  "${s.name}"  buy-in=${s.buyIn}€  players=${s.players.length}  rebuys=${sumRebuys}  pool=${pool}€${dup ? "   (ALREADY EXISTS — will skip)" : ""}`,
    );
    // Sanity check: every medallist must be in the players list.
    for (const [pos, name] of Object.entries(s.results)) {
      const inList = s.players.find(([n]) => norm(n) === norm(name));
      if (!inList) throw new Error(`${s.name}: ${pos} place "${name}" not in player list`);
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with `-- --apply` to write.");
    return;
  }

  // ----- WRITE PHASE -----

  for (const name of playersToCreate) {
    const created = await sheets.createPlayer(name);
    playerByNorm.set(norm(created.name), created);
    console.log(`  + player "${created.name}" id=${created.id.slice(0,8)}`);
    await sleep(SLEEP_MS);
  }
  for (const label of locationsToCreate) {
    const created = await sheets.createLocation(label);
    locByNorm.set(norm(created.name), created);
    console.log(`  + location "${created.name}" id=${created.id.slice(0,8)}`);
    await sleep(SLEEP_MS);
  }

  for (const s of SPECIALS) {
    const dup = tournaments.find(t => t.date === s.date && norm(t.name) === norm(s.name));
    if (dup) {
      console.log(`  = skip (duplicate exists): ${s.date} "${s.name}"`);
      continue;
    }
    const loc = locByNorm.get(norm(s.locationLabel));
    if (!loc) throw new Error(`Location not resolved: "${s.locationLabel}"`);

    const t = await sheets.createTournament({
      date: s.date,
      name: s.name,
      buy_in_amount: s.buyIn,
      payout_structure: [
        { position: 1, pct: s.payouts[0] },
        { position: 2, pct: s.payouts[1] },
        { position: 3, pct: s.payouts[2] },
      ],
      notes: "",
      location_id: loc.id,
      state: "Finished",
    });
    console.log(`  + tournament "${t.name}" id=${t.id.slice(0,8)}`);
    await sleep(SLEEP_MS);

    const finishByNorm = new Map<string, number>(
      Object.entries(s.results).map(([pos, name]) => [norm(name), Number(pos)]),
    );

    for (const [playerName, rebuys] of s.players) {
      const p = playerByNorm.get(norm(playerName));
      if (!p) throw new Error(`Player not resolved: "${playerName}"`);
      const finish = finishByNorm.get(norm(playerName)) ?? null;
      await sheets.createEntry({
        tournament_id: t.id,
        player_id: p.id,
        buy_ins: 1 + rebuys,
        finish_position: finish,
        payout_override: null,
      });
      await sleep(SLEEP_MS);
    }
    console.log(`    ✓ wrote ${s.players.length} entries`);
  }

  console.log("\n✓ Special tournaments imported.");
}

main().catch(e => { console.error(e); process.exit(1); });
