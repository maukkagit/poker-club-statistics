// Pure helpers for the tournament clock structure (blind levels + breaks).
// No React, no IO — used by the wizard's Structure step, the clock derivation
// and the API. Unit-tested in tests/tournament-structure.test.ts.
import type { BlindLevel, BreakRow, StructureRow } from "@/lib/types";

/** Default starting stack offered in the wizard (2026 NLH 6-Max Bounty Brawl). */
export const DEFAULT_STARTING_STACK = 4000;

/** Default per-level length (minutes) for newly added levels. */
export const DEFAULT_LEVEL_MINUTES = 20;

/** Default break length (minutes). */
export const DEFAULT_BREAK_MINUTES = 10;

function level(sb: number, bb: number, ante: number, duration_min = DEFAULT_LEVEL_MINUTES): BlindLevel {
  return { kind: "level", sb, bb, ante, duration_min };
}
function brk(duration_min = DEFAULT_BREAK_MINUTES): BreakRow {
  return { kind: "break", duration_min };
}

/**
 * The 2026 NLH 6-Max Bounty Brawl blind ladder (20-minute levels). Options:
 *   - `withAnte`: toggles the big-blind ante (equal to the big blind from
 *     Level 4 on) on or off.
 *   - `firstBreak`: include the break after Level 3 (the "Special" structure
 *     keeps it; the "simple" one drops it).
 *   - `mealBreakMinutes`: length of the meal break after Level 10 (40 for the
 *     Special structure, 10 for the simple one). The other breaks are always 10.
 */
function bountyBrawlLadder(opts: {
  withAnte: boolean;
  firstBreak?: boolean;
  mealBreakMinutes?: number;
  levelMinutes?: number;
}): StructureRow[] {
  const { withAnte, firstBreak = true, mealBreakMinutes = 40, levelMinutes = DEFAULT_LEVEL_MINUTES } = opts;
  const a = (bb: number) => (withAnte ? bb : 0);
  const lvl = (sb: number, bb: number, ante: number) => level(sb, bb, ante, levelMinutes);
  const rows: StructureRow[] = [
    lvl(20, 40, 0),
    lvl(20, 50, 0),
    lvl(30, 60, 0),
  ];
  if (firstBreak) rows.push(brk(10));
  rows.push(
    lvl(40, 80, a(80)),
    lvl(50, 100, a(100)),
    lvl(60, 120, a(120)),
    brk(10), // white colour-up
    lvl(100, 150, a(150)),
    lvl(100, 200, a(200)),
    lvl(100, 250, a(250)),
    lvl(150, 300, a(300)),
    brk(mealBreakMinutes), // meal break / red colour-up / re-entry ends
    lvl(200, 400, a(400)),
    lvl(200, 500, a(500)),
    lvl(300, 600, a(600)),
    lvl(400, 800, a(800)),
    brk(10), // green colour-up
    lvl(500, 1000, a(1000)),
    lvl(500, 1500, a(1500)),
    lvl(1000, 2000, a(2000)),
    lvl(1000, 3000, a(3000)),
    lvl(2000, 5000, a(5000)),
    lvl(3000, 7000, a(7000)),
    lvl(5000, 10000, a(10000)),
  );
  return rows;
}

/**
 * Selectable structure presets shown in the wizard's Structure step. Both use
 * the Bounty Brawl blind ladder and a 4,000 starting stack; they differ only in
 * whether the big-blind ante is in play.
 */
export type StructureTemplate = {
  id: string;
  name: string;
  startingStack: number;
  build: () => StructureRow[];
};

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  // Not a real preset — clears the ladder so the user builds every level by
  // hand with the "+ Level" / "+ Break" buttons. Listed first and used as the
  // default so the wizard opens on an empty ladder.
  { id: "scratch", name: "Start from scratch", startingStack: DEFAULT_STARTING_STACK, build: () => [] },
  { id: "no-ante", name: "Template 1 (Simple)", startingStack: DEFAULT_STARTING_STACK, build: () => bountyBrawlLadder({ withAnte: false, firstBreak: false, mealBreakMinutes: 10, levelMinutes: 12 }) },
  { id: "with-ante", name: "Template 2 (Special)", startingStack: DEFAULT_STARTING_STACK, build: () => bountyBrawlLadder({ withAnte: true }) },
];

/** The template selected by default when the wizard opens. */
export const DEFAULT_TEMPLATE_ID = "scratch";

/** Default structure used when the wizard first opens (the default template). */
export function defaultStructure(): StructureRow[] {
  const tpl = STRUCTURE_TEMPLATES.find(t => t.id === DEFAULT_TEMPLATE_ID) ?? STRUCTURE_TEMPLATES[0];
  return tpl.build();
}

/** True for level rows; narrows the union for TypeScript. */
export function isLevel(row: StructureRow): row is BlindLevel {
  return row.kind === "level";
}

/** Count of blind levels (excludes breaks) in a structure. */
export function levelCount(structure: StructureRow[]): number {
  return structure.reduce((n, r) => (r.kind === "level" ? n + 1 : n), 0);
}

/**
 * Validate a structure for the wizard. Returns a human-readable error string,
 * or null when the structure is valid. Mirrors the loose constraints the DB
 * tolerates: at least one level, positive durations, sane blinds.
 */
export function validateStructure(structure: StructureRow[]): string | null {
  if (!structure.length) return "Add at least one blind level.";
  if (levelCount(structure) === 0) return "Add at least one blind level (breaks alone aren't enough).";
  for (let i = 0; i < structure.length; i++) {
    const row = structure[i];
    if (!Number.isFinite(row.duration_min) || row.duration_min <= 0) {
      return `Row ${i + 1}: duration must be greater than 0 minutes.`;
    }
    if (row.kind === "level") {
      if (!Number.isFinite(row.sb) || row.sb < 0) return `Level ${i + 1}: small blind must be 0 or more.`;
      if (!Number.isFinite(row.bb) || row.bb <= 0) return `Level ${i + 1}: big blind must be greater than 0.`;
      if (row.bb < row.sb) return `Level ${i + 1}: big blind can't be smaller than the small blind.`;
      if (!Number.isFinite(row.ante) || row.ante < 0) return `Level ${i + 1}: ante must be 0 or more.`;
    }
  }
  return null;
}

/**
 * A blank blind level (all values 0) for manual entry. Paired with the
 * `blankZero` NumberInput option, its fields render empty so the director fills
 * in the blinds/ante/duration by hand. An untouched draft stays invalid (bb and
 * duration must be > 0), so it can't be saved half-built.
 */
export function emptyLevelDraft(): BlindLevel {
  return level(0, 0, 0, 0);
}
