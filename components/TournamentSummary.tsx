"use client";
import { useMemo } from "react";
import useSWR from "swr";
import type { Location, Player, PayoutSlot } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { MetricTile, IconWallet, IconUsers, IconCoin } from "@/components/MetricTile";

export type SummaryTournament = {
  id: string;
  date: string;
  name: string;
  buy_in_amount: number;
  payout_structure: PayoutSlot[];
  special?: boolean;
  location_id?: string | null;
  order_number?: number | null;
  display_name?: string;
};

export type SummaryEntry = {
  player_id: string;
  buy_ins: number;
  finish_position: number | null;
  payout_override: number | null;
};

function computePayouts(pool: number, structure: PayoutSlot[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of structure) m.set(s.position, (s.pct / 100) * pool);
  return m;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Gold / silver / bronze for the three steps of the visual podium, with the
// relative block heights that make 1st tower over 2nd and 3rd. The left→right
// stage order is 2-1-3, mirroring a real podium.
const PODIUM_META: Record<number, { color: string; height: number }> = {
  1: { color: "rgb(251 191 36)", height: 132 },
  2: { color: "rgb(203 213 225)", height: 104 },
  3: { color: "rgb(202 138 92)", height: 80 },
};
const STAGE_ORDER = [2, 1, 3];

/**
 * Read-only results view for a Finished tournament. Shows the headline numbers
 * (prize pool, field size, buy-in), a podium of the paid finishers, and a full
 * standings table ordered by finishing position. The "Edit" button hands off
 * to the dense editor for corrections.
 */
export default function TournamentSummary({
  tournament,
  entries,
  onEdit,
  onBack,
}: {
  tournament: SummaryTournament;
  entries: SummaryEntry[];
  onEdit: () => void;
  onBack: () => void;
}) {
  const { data: playersData } = useSWR<Player[]>(apiKeys.players);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playersData ?? []) m.set(p.id, p.name);
    return m;
  }, [playersData]);

  const { data: locationsData } = useSWR<Location[]>(apiKeys.locations);
  const locationName = tournament.location_id
    ? (locationsData ?? []).find(l => l.id === tournament.location_id)?.name ?? null
    : null;

  const totalBuyIns = entries.reduce((s, e) => s + (Number(e.buy_ins) || 0), 0);
  const prizePool = totalBuyIns * tournament.buy_in_amount;
  const computed = useMemo(
    () => computePayouts(prizePool, tournament.payout_structure),
    [prizePool, tournament.payout_structure],
  );

  const payoutOf = (e: SummaryEntry) =>
    e.payout_override != null
      ? e.payout_override
      : e.finish_position != null
        ? (computed.get(e.finish_position) ?? 0)
        : 0;

  // Standings: finishers first (ascending position), then anyone without a
  // recorded finish, alphabetised so the tail is stable.
  const standings = [...entries].sort((a, b) => {
    if (a.finish_position == null && b.finish_position == null) {
      return (nameById.get(a.player_id) ?? "").localeCompare(nameById.get(b.player_id) ?? "");
    }
    if (a.finish_position == null) return 1;
    if (b.finish_position == null) return -1;
    return a.finish_position - b.finish_position;
  });

  // Podium = paid positions with whoever finished there. "Paid" means a spot in
  // the payout structure OR any finisher who actually received money (e.g. a
  // manual payout_override not described by the structure), so e.g. a 2nd place
  // paid by override still shows up alongside 1st.
  const finisherAt = new Map<number, SummaryEntry>();
  for (const e of entries) if (e.finish_position != null) finisherAt.set(e.finish_position, e);
  const paidSet = new Set<number>(tournament.payout_structure.map(s => s.position));
  for (const e of entries) {
    if (e.finish_position != null && payoutOf(e) > 0) paidSet.add(e.finish_position);
  }
  const paidPositions = [...paidSet].sort((a, b) => a - b);
  const podium = paidPositions.map(position => {
    const e = finisherAt.get(position) ?? null;
    return {
      position,
      name: e ? (nameById.get(e.player_id) ?? "Unknown") : "—",
      amount: e ? payoutOf(e) : (computed.get(position) ?? 0),
    };
  });

  const podiumByPos = new Map(podium.map(r => [r.position, r]));
  // The stage always renders the three columns in 2-1-3 order so 1st place sits
  // dead center; missing spots (e.g. winner-take-all) become invisible spacers
  // rather than re-centering the whole illustration.
  const hasStage = STAGE_ORDER.some(pos => podiumByPos.has(pos));

  const playerCount = entries.length;

  const hasName = !!(tournament.name ?? "").trim();
  const title = hasName
    ? tournament.name
    : tournament.display_name
      ?? (tournament.order_number ? `Tournament #${tournament.order_number}` : "Tournament");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <div className="muted text-sm">
            {tournament.date}
            {locationName && <span> · {locationName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn btn-secondary" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>

      {/* Headline numbers — same KPI tiles as the dashboard "General stats",
          but without the description band so the value reads big. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <MetricTile label="Prize pool" value={`€${prizePool.toFixed(2)}`} icon={<IconWallet />} accent="emerald" showDescription={false} />
        <MetricTile label="Players" value={String(playerCount)} icon={<IconUsers />} accent="sky" showDescription={false} />
        <MetricTile label="Buy-in" value={`€${tournament.buy_in_amount.toFixed(2)}`} icon={<IconCoin />} accent="emerald" showDescription={false} />
        <MetricTile label="Total buy-ins" value={String(totalBuyIns)} icon={<IconCoin />} accent="amber" showDescription={false} />
      </div>

      {/* Podium */}
      <div className="card">
        <div className="text-sm muted mb-4">Podium</div>
        {hasStage && (
        <div className="flex items-end justify-center gap-2 sm:gap-3">
          {STAGE_ORDER.map(position => {
            const row = podiumByPos.get(position);
            const meta = PODIUM_META[position];
            // Keep the column (so 1st stays centered) but render nothing visible
            // when this placement wasn't paid.
            if (!row) {
              return <div key={position} aria-hidden className="flex-1 max-w-[180px] min-w-0" />;
            }
            return (
              <div key={position} className="flex flex-col items-center flex-1 max-w-[180px] min-w-0">
                {/* Name + payout sit above the block */}
                <div className="text-center mb-2 w-full px-1 min-w-0">
                  {/* Names shrink + wrap to a second line so long names fit the
                      narrow riser instead of being clipped. */}
                  <div
                    className="font-semibold text-sm leading-tight line-clamp-2 [overflow-wrap:anywhere]"
                    title={row.name}
                  >
                    {row.name}
                  </div>
                  <div className="text-sm muted">€{row.amount.toFixed(2)}</div>
                </div>
                {/* The riser block, taller for higher placements */}
                <div
                  className="w-full rounded-t-lg flex items-start justify-center"
                  style={{
                    height: meta.height,
                    background: `linear-gradient(180deg, color-mix(in srgb, ${meta.color} 42%, var(--bg)) 0%, color-mix(in srgb, ${meta.color} 16%, var(--bg)) 100%)`,
                    borderTop: `3px solid color-mix(in srgb, ${meta.color} 80%, transparent)`,
                    boxShadow: "inset 0 -10px 24px rgb(0 0 0 / 0.25)",
                  }}
                >
                  <span
                    className="font-black leading-none mt-3 select-none"
                    style={{
                      fontSize: position === 1 ? "2.75rem" : "2.25rem",
                      color: `color-mix(in srgb, ${meta.color} 85%, transparent)`,
                      textShadow: "0 1px 1px rgb(0 0 0 / 0.35)",
                    }}
                  >
                    {position}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Standings */}
      <div className="card">
        <div className="text-sm muted mb-3">Standings</div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Player</th>
                <th>Buy-ins</th>
                <th className="hidden md:table-cell">Cost</th>
                <th>Payout</th>
                <th className="hidden md:table-cell">Net</th>
              </tr>
            </thead>
            <tbody>
              {standings.map(e => {
                const cost = (Number(e.buy_ins) || 0) * tournament.buy_in_amount;
                const payout = payoutOf(e);
                const net = payout - cost;
                return (
                  <tr key={e.player_id}>
                    <td>{e.finish_position != null ? ordinal(e.finish_position) : <span className="muted">—</span>}</td>
                    <td>{nameById.get(e.player_id) ?? <span className="muted">Unknown</span>}</td>
                    <td>{e.buy_ins}</td>
                    <td className="hidden md:table-cell">€{cost.toFixed(2)}</td>
                    <td>{payout > 0 ? `€${payout.toFixed(2)}` : <span className="muted">—</span>}</td>
                    <td className={`hidden md:table-cell ${net >= 0 ? "pos" : "neg"}`}>€{net.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

