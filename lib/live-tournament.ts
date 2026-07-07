// Pure derivations for the live-tournament director console
// (components/LiveTournamentManager.tsx). Kept out of the component so the view
// math (partitioning, podium, physical layout, table views, free seats) is
// unit-testable and the component is mostly render. No React, no IO.
import type { PayoutSlot, Seating, StructureRow, TournamentClock, Knockout } from "@/lib/types";
import { freeSeats, type Layout } from "@/lib/seating";
import type { TableOccupant } from "@/components/PokerTable";

export type LiveEntry = {
  player_id: string;
  buy_ins: number;
  finish_position: number | null;
  table_no: number | null;
  seat_no: number | null;
  bucket: number | null;
  // Computed euro payout for this entry (includes any deal/override).
  payout: number;
  // PKO cash bounty won so far (0 for normal tournaments).
  bounty_won?: number;
  // True when added live (late entry); only these can be removed.
  late_entry?: boolean;
  // The seat this player last sat in before busting (cleared seat on bust).
  last_table_no?: number | null;
  last_seat_no?: number | null;
};

export type LiveDetail = {
  tournament: {
    id: string;
    date: string;
    name: string;
    notes?: string | null;
    location_id?: string | null;
    special?: boolean;
    state: "Active" | "Finished";
    buy_in_amount: number;
    payout_structure: PayoutSlot[];
    payout_overrides?: Record<string, number> | null;
    seating: Seating | null;
    rebuys_allowed: boolean;
    rebuy_window_open: boolean;
    // Level at which re-entries auto-close (null = managed manually).
    rebuy_close_level?: number | null;
    // Director-controlled viewer-link clock sound effects (default on).
    sound_enabled?: boolean;
    sound_knockouts_enabled?: boolean;
    title_gradient_enabled?: boolean;
    version: number;
    display_name?: string;
    // Tournament clock (issue #21).
    structure?: StructureRow[];
    starting_stack?: number | null;
    clock?: TournamentClock | null;
    share_token?: string | null;
    // Progressive knockout (PKO) config.
    is_pko?: boolean;
    bounty_start_amount?: number;
    bounty_start_level?: number | null;
    bounty_chip?: number;
    // Per-tournament photo (public Storage URL), managed from the Basic info
    // tab and the finish prompt. Null/absent when no photo is set.
    image_url?: string | null;
  };
  entries: LiveEntry[];
  // PKO knockout ledger (empty for normal tournaments).
  knockouts?: Knockout[];
};

export type PodiumRow = {
  position: number;
  pct: number;
  amount: number;          // current payout (deal override if set, else % of pool)
  originalAmount: number;  // pool × pct (what the % structure pays)
  player_id: string | null;
  name: string;
};

/** Split entries into alive, busted (sorted by finish) and seated (alive with a seat). */
export function partitionEntries(entries: LiveEntry[]): {
  alive: LiveEntry[];
  busted: LiveEntry[];
  seated: LiveEntry[];
} {
  const alive = entries.filter(e => e.finish_position == null);
  const busted = entries
    .filter(e => e.finish_position != null)
    .sort((a, b) => (a.finish_position ?? 0) - (b.finish_position ?? 0));
  const seated = alive.filter(e => e.seat_no != null && e.table_no != null);
  return { alive, busted, seated };
}

/** Occupied physical seats per table (for picking random open seats on moves). */
export function buildOccupiedByTable(seated: LiveEntry[]): Map<number, number[]> {
  const occupiedByTable = new Map<number, number[]>();
  for (const e of seated) {
    const arr = occupiedByTable.get(e.table_no!) ?? [];
    arr.push(e.seat_no!);
    occupiedByTable.set(e.table_no!, arr);
  }
  return occupiedByTable;
}

/**
 * Every open physical seat across all tables — used to drop a late entrant into
 * a random empty chair. When no seats are drawn yet there are none.
 */
export function buildFreeSlots(
  hasSeats: boolean,
  totalTables: number,
  occupiedByTable: Map<number, number[]>,
  seatsPerTable: number,
): { table_no: number; seat_no: number }[] {
  const freeSlots: { table_no: number; seat_no: number }[] = [];
  if (hasSeats) {
    for (let tno = 1; tno <= totalTables; tno++) {
      for (const s of freeSeats(occupiedByTable.get(tno) ?? [], seatsPerTable)) {
        freeSlots.push({ table_no: tno, seat_no: s });
      }
    }
  }
  return freeSlots;
}

/**
 * The amount each paid position pays right now: a deal override if set,
 * otherwise pool × pct. The confirmed player's name is filled in once they
 * finish in that place. Sorted by position ascending.
 */
export function buildPodium(
  payoutStructure: PayoutSlot[],
  prizePool: number,
  payoutOverrides: Record<string, number> | null | undefined,
  entries: LiveEntry[],
  nameById: Map<string, string>,
): PodiumRow[] {
  const playerAtPosition = new Map<number, LiveEntry>();
  for (const e of entries) if (e.finish_position != null) playerAtPosition.set(e.finish_position, e);
  return [...payoutStructure]
    .sort((a, b) => a.position - b.position)
    .map(slot => {
      const originalAmount = prizePool * (slot.pct / 100);
      const override = payoutOverrides?.[String(slot.position)];
      const amount = override != null ? override : originalAmount;
      const at = playerAtPosition.get(slot.position) ?? null;
      return {
        position: slot.position,
        pct: slot.pct,
        amount,
        originalAmount,
        player_id: at?.player_id ?? null,
        name: at ? (nameById.get(at.player_id) ?? "?") : "—",
      };
    });
}

/**
 * Current physical layout (alive, seated players grouped by table in ring
 * order).
 */
export function buildLayout(seated: LiveEntry[], seatsPerTable: number): Layout {
  const byTable = new Map<number, LiveEntry[]>();
  for (const e of seated) {
    if (!byTable.has(e.table_no!)) byTable.set(e.table_no!, []);
    byTable.get(e.table_no!)!.push(e);
  }
  return {
    seats_per_table: seatsPerTable,
    tables: [...byTable.entries()].sort((a, b) => a[0] - b[0]).map(([tno, es]) => ({
      table_no: tno,
      occupants: [...es].sort((a, b) => a.seat_no! - b.seat_no!).map(e => e.player_id),
    })),
  };
}

/** Tables for visualization (occupants at their real physical seats). */
export function buildTableViews(
  occupiedByTable: Map<number, number[]>,
  seated: LiveEntry[],
  nameById: Map<string, string>,
): { table_no: number; occupants: TableOccupant[] }[] {
  return [...occupiedByTable.keys()].sort((a, b) => a - b).map(tno => ({
    table_no: tno,
    occupants: seated
      .filter(e => e.table_no === tno)
      .map(e => ({ player_id: e.player_id, name: nameById.get(e.player_id) ?? "?", seat_no: e.seat_no! })),
  }));
}
