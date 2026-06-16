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
 * Template 1 (Simple) blind ladder — no ante, 12-minute levels, no first break,
 * short meal break. Kept as a lightweight starting point for casual games.
 */
function simpleLadder(): StructureRow[] {
  const m = 12;
  return [
    level(20, 40, 0, m),
    level(20, 50, 0, m),
    level(30, 60, 0, m),
    level(40, 80, 0, m),
    level(50, 100, 0, m),
    level(60, 120, 0, m),
    brk(10),
    level(100, 150, 0, m),
    level(100, 200, 0, m),
    level(100, 250, 0, m),
    level(150, 300, 0, m),
    brk(10),
    level(200, 400, 0, m),
    level(200, 500, 0, m),
    level(300, 600, 0, m),
    level(400, 800, 0, m),
    brk(10),
    level(500, 1000, 0, m),
    level(500, 1500, 0, m),
    level(1000, 2000, 0, m),
    level(1000, 3000, 0, m),
    level(2000, 5000, 0, m),
    level(3000, 7000, 0, m),
    level(5000, 10000, 0, m),
  ];
}

/**
 * Template 2 (Special) — the exact 2026 NLH 6-Max Bounty Brawl structure
 * with big-blind antes and 15-minute levels, as published in the tournament
 * guide. Levels 1–9 are the pre-bounty / re-entry phase; the 40-minute meal
 * break after Level 9 closes re-entries and opens the bounty phase (Level 10+).
 */
function specialLadder(): StructureRow[] {
  const m = 15;
  return [
    // Pre-bounty / re-entry phase (Levels 1–9)
    level( 20,   20,   20, m),
    level( 20,   40,   40, m),
    level( 20,   60,   60, m),
    level( 40,   80,   80, m),
    brk(10),
    level( 40,  100,  100, m),
    level( 60,  120,  120, m),
    level( 80,  160,  160, m),
    level(100,  200,  200, m),
    level(120,  240,  240, m),
    // 40-min meal break — re-entry ends, bounty phase begins at Level 10
    brk(40),
    // Bounty phase (Levels 10–25)
    level( 200,  300,  300, m),
    level( 200,  400,  400, m),
    level( 200,  500,  500, m),
    level( 300,  600,  600, m),
    level( 400,  800,  800, m),
    brk(10),
    level( 400, 1000, 1000, m),
    level( 600, 1200, 1200, m),
    level( 800, 1600, 1600, m),
    level(1000, 2000, 2000, m),
    level(1200, 2400, 2400, m),
    brk(10),
    level(2000, 3000, 3000, m),
    level(2000, 4000, 4000, m),
    level(2000, 5000, 5000, m),
    level(3000, 6000, 6000, m),
    level(4000, 8000, 8000, m),
    level(5000, 10000, 10000, m),
  ];
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
  { id: "no-ante", name: "Template 1 (Simple)", startingStack: DEFAULT_STARTING_STACK, build: simpleLadder },
  { id: "with-ante", name: "Template 2 (Special)", startingStack: DEFAULT_STARTING_STACK, build: specialLadder },
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
