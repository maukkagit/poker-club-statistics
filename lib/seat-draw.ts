import { drawSeats, type SeatAssignment } from "@/lib/seating";
import type { Seating } from "@/lib/types";

export type DrawPlayerInfo = { player_id: string; name: string; bucket?: number | null };

export type DrawResult = {
  seating: Seating;
  assignments: { player_id: string; table_no: number; seat_no: number }[];
  // The bucket actually applied per player for this draw (empty when buckets
  // were off). Persisted onto entries.bucket so re-draws keep the same tiers.
  bucketByPlayerId: Record<string, number>;
};

export type DrawConfig = {
  players: DrawPlayerInfo[];
  tables: number;
  seatsPerTable: number;
  bucketsEnabled: boolean;
  // Per-player bucket inputs; "" means "left blank" and is ignored.
  buckets: Record<string, number | "">;
};

/**
 * Pure seat-draw computation extracted from SeatDrawPanel. Given the panel's
 * configuration plus injectable `rng`/`now`, produce the {@link DrawResult}
 * (seating metadata + per-player table/seat assignments). The randomness and
 * clock are parameters so the result is fully deterministic under test.
 *
 * Mirrors the previous inline logic exactly: buckets only apply when enabled
 * AND at least one valid integer was entered; the button defaults to seat 1
 * on every table.
 */
export function buildDrawResult(
  config: DrawConfig,
  rng: () => number = Math.random,
  now: () => string = () => new Date().toISOString(),
): DrawResult {
  const { players, tables, seatsPerTable, bucketsEnabled, buckets } = config;
  const bucketByPlayerId: Record<string, number> = {};
  if (bucketsEnabled) {
    for (const p of players) {
      const b = buckets[p.player_id];
      if (b !== "" && b != null && Number.isFinite(Number(b))) bucketByPlayerId[p.player_id] = Number(b);
    }
  }
  const usingBuckets = bucketsEnabled && Object.keys(bucketByPlayerId).length > 0;
  const assignments: SeatAssignment[] = drawSeats(
    players.map(p => ({ player_id: p.player_id })),
    tables, seatsPerTable,
    rng,
    usingBuckets ? { bucketByPlayerId } : undefined,
  );
  // Button defaults to seat 1 on every table; the director can adjust the
  // button live during rebalancing.
  const buttonsObj: Record<string, number> = {};
  for (let t = 1; t <= tables; t++) buttonsObj[String(t)] = 1;
  const seating: Seating = {
    tables,
    seats_per_table: seatsPerTable,
    buckets_used: usingBuckets,
    buttons: buttonsObj,
    drawn_at: now(),
  };
  return { seating, assignments, bucketByPlayerId: usingBuckets ? bucketByPlayerId : {} };
}

/**
 * Build a {@link DrawResult} from a director's manual seat placements. Buckets
 * are never applied in manual mode — the seating metadata still stamps
 * `buckets_used: false` and empty `bucketByPlayerId`.
 */
export function buildManualDrawResult(opts: {
  players: DrawPlayerInfo[];
  tables: number;
  seatsPerTable: number;
  assignments: { player_id: string; table_no: number; seat_no: number }[];
  now?: () => string;
}): DrawResult {
  const { players, tables, seatsPerTable, assignments, now = () => new Date().toISOString() } = opts;
  const known = new Set(players.map(p => p.player_id));
  const clean = assignments.filter(a => known.has(a.player_id));
  const buttonsObj: Record<string, number> = {};
  for (let t = 1; t <= tables; t++) buttonsObj[String(t)] = 1;
  return {
    seating: {
      tables,
      seats_per_table: seatsPerTable,
      buckets_used: false,
      buttons: buttonsObj,
      drawn_at: now(),
    },
    assignments: clean,
    bucketByPlayerId: {},
  };
}
