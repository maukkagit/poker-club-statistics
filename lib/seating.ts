/**
 * Pure seat-draw / table-balancing engine (issue #20).
 *
 * NO IO, NO React, NO Date.now() — every source of nondeterminism (the RNG) is
 * injected, so the same inputs always produce the same output and the whole
 * module is trivially unit-testable. The UI previews the result of these
 * functions and the Postgres RPCs re-validate the same invariants, so "what you
 * see is what gets written".
 *
 * Vocabulary:
 *  - A *ring* is a table's current occupants as an ordered array. `seat_no` is
 *    just `index + 1` — a gapless 1..N index among the people actually sitting
 *    there. Busting/moving someone re-indexes the ring so there's never a gap.
 *  - The *button* is stored per table as an index into that ring; blinds derive
 *    from it (heads-up: button posts the small blind).
 */

export type Rng = () => number; // returns a float in [0, 1)

export type DrawPlayer = { player_id: string };

export type SeatAssignment = {
  player_id: string;
  table_no: number; // 1-indexed
  seat_no: number;  // 1-indexed, gapless within its table
};

export type DrawOptions = {
  /**
   * Map of player_id -> performance bucket (any positive integer; uneven
   * bucket sizes are fine). When present and at least one player has a bucket,
   * the draw spreads each bucket as evenly as possible across tables. When
   * absent/empty the draw is a plain shuffle + round-robin.
   */
  bucketByPlayerId?: Record<string, number>;
};

export const MAX_SEATS_PER_TABLE = 10;

// ---------------------------------------------------------------------------
// RNG helpers
// ---------------------------------------------------------------------------

/**
 * A small, seedable PRNG (mulberry32). Handy for deterministic UI previews and
 * tests. Production draws can pass `Math.random` directly.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle using the injected RNG. Pure — returns a new array. */
export function shuffle<T>(input: readonly T[], rng: Rng): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Capacity defaults
// ---------------------------------------------------------------------------

/**
 * Suggested table layout for a field of `playerCount` players. `seats_per_table`
 * is a capacity / rebalance threshold (capped at {@link MAX_SEATS_PER_TABLE}),
 * not a hard visual constraint.
 *
 *  ≤ 9     → 1 table,  9 seats
 *  10–14   → 2 tables, ceil(players / 2) seats
 *  > 14    → ceil(players / 6) tables, 6 seats (6-max)
 */
export function seatingDefaults(playerCount: number): { tables: number; seats_per_table: number } {
  const n = Math.max(0, Math.floor(playerCount || 0));
  if (n <= 9) return { tables: 1, seats_per_table: 9 };
  if (n <= 14) return { tables: 2, seats_per_table: Math.min(MAX_SEATS_PER_TABLE, Math.ceil(n / 2)) };
  return { tables: Math.ceil(n / 6), seats_per_table: 6 };
}

/** Valid table sizes the director chooses from in the wizard. */
export const TABLE_SIZES = [6, 9, 10] as const;
export type TableSize = (typeof TABLE_SIZES)[number];

/**
 * Default table format (max seats per table) for a field: 6-max by default,
 * bumped to 9-max for 7–9 players and 10-max beyond that. The director can
 * still override it.
 */
export function defaultMaxSeats(playerCount: number): TableSize {
  const n = Math.max(0, Math.floor(playerCount || 0));
  if (n <= 6) return 6;
  if (n <= 9) return 9;
  return 10;
}

/** Number of tables needed to seat `playerCount` players at `seatsPerTable`. */
export function tablesFor(playerCount: number, seatsPerTable: number): number {
  const n = Math.max(0, Math.floor(playerCount || 0));
  const spt = Math.max(1, Math.floor(seatsPerTable || 1));
  return Math.max(1, Math.ceil(n / spt));
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

/**
 * Assign every player a (table_no, seat_no). Plain mode = shuffle then deal
 * round-robin across tables. Bucketed mode = group by bucket, shuffle within
 * each, then deal each bucket round-robin across tables continuing the cursor
 * between buckets, so every bucket is spread as evenly as the field allows;
 * finally each table's ring is shuffled so the seat order within a table is
 * random rather than grouped by bucket.
 *
 * Seat numbers are assigned gaplessly per table in deal order (1..N).
 */
export function drawSeats(
  players: readonly DrawPlayer[],
  tables: number,
  _seatsPerTable: number,
  rng: Rng,
  opts?: DrawOptions,
): SeatAssignment[] {
  const T = Math.max(1, Math.floor(tables || 1));
  const buckets = opts?.bucketByPlayerId;
  const useBuckets = !!buckets && players.some(p => buckets[p.player_id] != null);

  const perTable: string[][] = Array.from({ length: T }, () => []);

  if (!useBuckets) {
    const shuffled = shuffle(players, rng);
    shuffled.forEach((p, i) => {
      perTable[i % T].push(p.player_id);
    });
  } else {
    // Group by bucket (players without a bucket fall into a synthetic "last"
    // group so they're still seated). Deal low buckets first; keep a single
    // table cursor across buckets so the spread stays even for uneven sizes.
    const UNBUCKETED = Number.MAX_SAFE_INTEGER;
    const groups = new Map<number, DrawPlayer[]>();
    for (const p of players) {
      const b = buckets![p.player_id] ?? UNBUCKETED;
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(p);
    }
    const orderedKeys = [...groups.keys()].sort((a, b) => a - b);
    let cursor = 0;
    for (const key of orderedKeys) {
      const grp = shuffle(groups.get(key)!, rng);
      for (const p of grp) {
        perTable[cursor % T].push(p.player_id);
        cursor++;
      }
    }
    // Round-robin dealing keeps each bucket spread evenly across tables, but it
    // also leaves every table's ring grouped by bucket (e.g. [b1,b1,b2,b2,…]),
    // which would pin each tier to fixed seats. Shuffle within each table so the
    // *seat order* is random too — every table still holds its even share of
    // each bucket, just in a random arrangement.
    for (let ti = 0; ti < T; ti++) {
      perTable[ti] = shuffle(perTable[ti], rng);
    }
  }

  const out: SeatAssignment[] = [];
  perTable.forEach((occupants, ti) => {
    occupants.forEach((pid, si) => {
      out.push({ player_id: pid, table_no: ti + 1, seat_no: si + 1 });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Blinds
// ---------------------------------------------------------------------------

export type Blinds<T> = {
  buttonIndex: number;
  sbIndex: number;
  bbIndex: number;
  button: T | null;
  sb: T | null;
  bb: T | null;
};

/**
 * Resolve button / small-blind / big-blind for a ring, given the button's
 * index. Heads-up (2 players) is the special case where the button *is* the
 * small blind. Indices wrap around the ring.
 */
export function computeBlinds<T>(ring: readonly T[], buttonIndex: number): Blinds<T> {
  const n = ring.length;
  if (n <= 0) return { buttonIndex: -1, sbIndex: -1, bbIndex: -1, button: null, sb: null, bb: null };
  const btn = ((Math.floor(buttonIndex) % n) + n) % n;
  if (n === 1) {
    return { buttonIndex: btn, sbIndex: btn, bbIndex: btn, button: ring[btn], sb: ring[btn], bb: ring[btn] };
  }
  if (n === 2) {
    const bb = (btn + 1) % n;
    return { buttonIndex: btn, sbIndex: btn, bbIndex: bb, button: ring[btn], sb: ring[btn], bb: ring[bb] };
  }
  const sb = (btn + 1) % n;
  const bb = (btn + 2) % n;
  return { buttonIndex: btn, sbIndex: sb, bbIndex: bb, button: ring[btn], sb: ring[sb], bb: ring[bb] };
}

/**
 * Given the player who is currently in the big blind, derive the real button
 * index for a ring: heads-up the BB's opponent is the button; otherwise the
 * button is two seats before the BB (BB ← SB ← button, clockwise).
 */
export function buttonFromBigBlind(ringLength: number, bbIndex: number): number {
  const n = ringLength;
  if (n <= 0) return -1;
  const bb = ((Math.floor(bbIndex) % n) + n) % n;
  if (n === 1) return bb;
  if (n === 2) return (bb + 1) % n; // heads-up: button = the other player (= SB)
  return ((bb - 2) % n + n) % n;
}

// ---------------------------------------------------------------------------
// Rebalancing
// ---------------------------------------------------------------------------

export type TableState = {
  table_no: number;
  occupants: string[]; // player ids in ring (seat) order
};

export type Layout = {
  tables: TableState[];
  seats_per_table: number;
};

export type RebalanceSuggestion =
  | { kind: "none" }
  | { kind: "move"; fromTable: number; toTable: number; reason: string }
  | { kind: "break"; breakTable: number; intoTables: number[]; reason: string }
  | { kind: "final"; intoTable: number; fromTables: number[]; reason: string };

function aliveCount(layout: Layout): number {
  return layout.tables.reduce((s, t) => s + t.occupants.length, 0);
}

/**
 * Suggest the next MTT rebalancing action (never automatic). Precedence is
 * collapse → break → move:
 *  - `alive ≤ seats_per_table`            → collapse to a single final table.
 *  - `alive ≤ (tables−1)·seats_per_table` → break the shortest table.
 *  - max-min occupants differ by > 1      → move one from the biggest to the
 *                                           smallest table.
 *  - otherwise                            → none.
 *
 * Tables with zero occupants are ignored (already broken). With ≤ 1 live table
 * there is nothing to suggest.
 */
export function rebalanceSuggestion(layout: Layout): RebalanceSuggestion {
  const spt = Math.max(1, layout.seats_per_table || 1);
  const live = layout.tables.filter(t => t.occupants.length > 0);
  const nTables = live.length;
  if (nTables <= 1) return { kind: "none" };

  const alive = aliveCount(layout);

  if (alive <= spt) {
    // Everyone fits at one table — collapse to the fullest as the final table.
    const target = [...live].sort((a, b) => b.occupants.length - a.occupants.length)[0];
    return {
      kind: "final",
      intoTable: target.table_no,
      fromTables: live.filter(t => t.table_no !== target.table_no).map(t => t.table_no),
      reason: `${alive} players left — collapse to a final table.`,
    };
  }

  if (alive <= (nTables - 1) * spt) {
    // One fewer table is enough — break the shortest.
    const shortest = [...live].sort(
      (a, b) => a.occupants.length - b.occupants.length || a.table_no - b.table_no,
    )[0];
    return {
      kind: "break",
      breakTable: shortest.table_no,
      intoTables: live.filter(t => t.table_no !== shortest.table_no).map(t => t.table_no),
      reason: `${alive} players fit on ${nTables - 1} tables — break table ${shortest.table_no}.`,
    };
  }

  const sorted = [...live].sort((a, b) => b.occupants.length - a.occupants.length);
  const biggest = sorted[0];
  const smallest = sorted[sorted.length - 1];
  if (biggest.occupants.length - smallest.occupants.length > 1) {
    return {
      kind: "move",
      fromTable: biggest.table_no,
      toTable: smallest.table_no,
      reason: `Tables differ by ${biggest.occupants.length - smallest.occupants.length} — move a player from table ${biggest.table_no} to table ${smallest.table_no}.`,
    };
  }

  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Fixed seats (holes allowed)
// ---------------------------------------------------------------------------
//
// Seats are physical 1..seats_per_table positions. Busting or moving a player
// empties their seat and leaves a hole — the remaining players never shift to
// fill it. New arrivals (rebalance move / table break) take a *random* open
// seat at their destination table.

/** Free seat numbers (1..seatsPerTable) not in `occupied`, ascending. */
export function freeSeats(occupied: readonly number[], seatsPerTable: number): number[] {
  const spt = Math.max(0, Math.floor(seatsPerTable || 0));
  const taken = new Set(occupied);
  const out: number[] = [];
  for (let s = 1; s <= spt; s++) if (!taken.has(s)) out.push(s);
  return out;
}

/** Pick a random free seat at a table, or null when the table is full. */
export function randomFreeSeat(occupied: readonly number[], seatsPerTable: number, rng: Rng): number | null {
  const free = freeSeats(occupied, seatsPerTable);
  if (free.length === 0) return null;
  return free[Math.floor(rng() * free.length)];
}

export type TableSeats = { table_no: number; occupied: number[] };

/**
 * Plan a table break: redistribute `brokenPlayers` to the remaining tables.
 * Table choice stays balanced (fewest occupants first) so the field doesn't
 * immediately need re-rebalancing, but the *seat* within the chosen table is
 * random — matching "randomly assigned to the available seats". Pure: returns
 * assignments and never mutates its inputs.
 */
export function planBreak(
  brokenPlayers: readonly string[],
  remaining: readonly TableSeats[],
  seatsPerTable: number,
  rng: Rng,
): SeatAssignment[] {
  // Mutable working copy of each remaining table's occupied seats.
  const tables = remaining.map(t => ({ table_no: t.table_no, occupied: t.occupied.slice() }));
  const out: SeatAssignment[] = [];
  for (const pid of shuffle(brokenPlayers, rng)) {
    // Fewest occupants first; ties broken by table_no for determinism.
    const target = [...tables]
      .filter(t => freeSeats(t.occupied, seatsPerTable).length > 0)
      .sort((a, b) => a.occupied.length - b.occupied.length || a.table_no - b.table_no)[0];
    if (!target) break; // no capacity left (shouldn't happen if sized correctly)
    const seat = randomFreeSeat(target.occupied, seatsPerTable, rng)!;
    target.occupied.push(seat);
    out.push({ player_id: pid, table_no: target.table_no, seat_no: seat });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applying rebalancing actions (pure — return a fresh Layout)
// ---------------------------------------------------------------------------

function cloneLayout(layout: Layout): Layout {
  return {
    seats_per_table: layout.seats_per_table,
    tables: layout.tables.map(t => ({ table_no: t.table_no, occupants: t.occupants.slice() })),
  };
}

/**
 * Move one player from `fromTable` to the end of `toTable`'s ring. The moved
 * player is normally the one about to be the big blind on the losing table (so
 * positions stay fair); pass their id explicitly, otherwise the last seat is
 * moved. Re-indexing is implicit (occupants are a gapless array).
 */
export function applyMove(layout: Layout, fromTable: number, toTable: number, playerId?: string): Layout {
  const next = cloneLayout(layout);
  const from = next.tables.find(t => t.table_no === fromTable);
  const to = next.tables.find(t => t.table_no === toTable);
  if (!from || !to || from.occupants.length === 0) return next;
  const pid = playerId && from.occupants.includes(playerId)
    ? playerId
    : from.occupants[from.occupants.length - 1];
  from.occupants = from.occupants.filter(p => p !== pid);
  to.occupants.push(pid);
  return next;
}

/**
 * Break `breakTable`, redistributing its players one at a time to the currently
 * shortest remaining table (filling the field evenly). The broken table is left
 * with an empty ring.
 */
export function applyBreak(layout: Layout, breakTable: number): Layout {
  const next = cloneLayout(layout);
  const broken = next.tables.find(t => t.table_no === breakTable);
  if (!broken) return next;
  const others = next.tables.filter(t => t.table_no !== breakTable && t.occupants.length >= 0);
  const movers = broken.occupants.slice();
  broken.occupants = [];
  const targets = others.filter(t => t.table_no !== breakTable);
  for (const pid of movers) {
    // Re-evaluate the shortest target each time so we fill evenly.
    targets.sort((a, b) => a.occupants.length - b.occupants.length || a.table_no - b.table_no);
    (targets[0] ?? broken).occupants.push(pid);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Geometry for the table visualization
// ---------------------------------------------------------------------------

export type SeatPoint = { x: number; y: number; angle: number };

/**
 * Evenly spaced seat coordinates around an oval, starting bottom-center and
 * going clockwise, for `n` occupants. Points are "squared toward the edges"
 * (superellipse) so they hug a rounded-rectangle table instead of bunching at
 * the narrow ends of a thin ellipse — matching common poker-table UIs.
 *
 * Returned in SVG coordinate space (y grows downward) within the given
 * center/radii (defaults assume a 100×60 viewBox).
 */
export function seatPositions(
  n: number,
  opts?: { cx?: number; cy?: number; rx?: number; ry?: number; squareness?: number },
): SeatPoint[] {
  const count = Math.max(0, Math.floor(n || 0));
  if (count === 0) return [];
  const cx = opts?.cx ?? 50;
  const cy = opts?.cy ?? 30;
  const rx = opts?.rx ?? 44;
  const ry = opts?.ry ?? 24;
  // squareness in [0,1]: 0 = pure ellipse, 1 = pushed hard to the rectangle.
  const sq = Math.min(1, Math.max(0, opts?.squareness ?? 0.45));

  // Map a parametric angle to a point on the squared ellipse (superellipse).
  // Start at bottom-center (angle π/2 → +y, i.e. bottom in SVG) and advance
  // clockwise as the angle grows.
  const point = (angle: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Superellipse-style squaring: blend the unit-circle component with its
    // square-rooted magnitude (which pushes points toward ±1).
    const sqx = Math.sign(c) * Math.pow(Math.abs(c), 1 - sq);
    const sqy = Math.sign(s) * Math.pow(Math.abs(s), 1 - sq);
    return { x: cx + rx * sqx, y: cy + ry * sqy };
  };

  // Distribute seats by EQUAL ARC LENGTH around the perimeter rather than by
  // equal angle. Equal-angle stepping bunches seats where the squared-ellipse
  // curves hardest (and stretches them along the flat runs), which looks
  // lopsided and forces the chips to shrink to avoid the tightest pair. Walking
  // equal perimeter distance gives visually even gaps between every seat.
  const SAMPLES = 1440;
  const start = Math.PI / 2;
  const sample: Array<{ angle: number; x: number; y: number; len: number }> = [];
  let prev = point(start);
  let cum = 0;
  for (let k = 0; k <= SAMPLES; k++) {
    const angle = start + (2 * Math.PI * k) / SAMPLES;
    const p = point(angle);
    if (k > 0) cum += Math.hypot(p.x - prev.x, p.y - prev.y);
    sample.push({ angle, x: p.x, y: p.y, len: cum });
    prev = p;
  }
  const total = cum;

  const pts: SeatPoint[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / count;
    // Advance to the first sample whose cumulative length reaches `target`,
    // then interpolate between it and the previous sample for a smooth fit.
    while (cursor < sample.length - 1 && sample[cursor].len < target) cursor++;
    const hi = sample[cursor];
    const lo = sample[Math.max(0, cursor - 1)];
    const span = hi.len - lo.len;
    const f = span > 1e-9 ? (target - lo.len) / span : 0;
    pts.push({
      x: lo.x + (hi.x - lo.x) * f,
      y: lo.y + (hi.y - lo.y) * f,
      angle: lo.angle + (hi.angle - lo.angle) * f,
    });
  }
  return pts;
}
