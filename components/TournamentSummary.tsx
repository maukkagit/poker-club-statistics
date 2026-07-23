"use client";
import { useMemo } from "react";
import useSWR from "swr";
import type { Location, Player, PayoutSlot, Knockout, Tournament, Entry } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { computeEntries } from "@/lib/db/stats";
import { MetricTile, IconWallet, IconUsers, IconCoin } from "@/components/MetricTile";
import { ordinal, eur } from "@/lib/format";
import { imageObjectPosition } from "@/lib/image-focus";
import { computeBountyState, bountyConfig, formatKoCount } from "@/lib/pko";

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
  // PKO bounty config — when `is_pko`, the summary derives per-player knockout
  // counts and bounty cash from the knockout ledger.
  is_pko?: boolean;
  bounty_start_amount?: number;
  bounty_chip?: number;
  // Add-ons fund the regular prize pool; when enabled, standings show a column.
  addons_allowed?: boolean;
  addon_price?: number;
  // Deal (manual payout by position) overrides the percentage split.
  payout_overrides?: Record<string, number> | null;
  // Public URL of the tournament's photo, if one was attached.
  image_url?: string | null;
  image_focus_x?: number | null;
  image_focus_y?: number | null;
};

export type SummaryEntry = {
  player_id: string;
  buy_ins: number;
  finish_position: number | null;
  payout_override: number | null;
  addons?: number;
};

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
  knockouts = [],
  onEdit,
  onBack,
}: {
  tournament: SummaryTournament;
  entries: SummaryEntry[];
  knockouts?: Knockout[];
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

  const isPko = !!tournament.is_pko;
  const addonPrice = tournament.addon_price ?? 0;
  const showAddons = !!tournament.addons_allowed;
  const totalBuyIns = entries.reduce((s, e) => s + (Number(e.buy_ins) || 0), 0);

  const entriesForCompute: Entry[] = useMemo(
    () => entries.map((e, i) => ({
      id: `summary-${e.player_id}-${i}`,
      tournament_id: tournament.id,
      player_id: e.player_id,
      buy_ins: Number(e.buy_ins) || 0,
      finish_position: e.finish_position,
      payout_override: e.payout_override,
      addons: e.addons ?? 0,
    })),
    [entries, tournament.id],
  );

  const tournamentForCompute = useMemo((): Tournament => ({
    id: tournament.id,
    date: tournament.date,
    name: tournament.name,
    buy_in_amount: tournament.buy_in_amount,
    payout_structure: tournament.payout_structure,
    payout_overrides: tournament.payout_overrides ?? null,
    notes: "",
    location_id: tournament.location_id ?? null,
    state: "Finished",
    special: !!tournament.special,
    is_pko: tournament.is_pko,
    bounty_start_amount: tournament.bounty_start_amount,
    bounty_chip: tournament.bounty_chip,
    addon_price: addonPrice,
    addons_allowed: showAddons,
    version: 0,
    created_at: tournament.date,
  }), [tournament, addonPrice, showAddons]);

  const computed = useMemo(
    () => computeEntries(tournamentForCompute, entriesForCompute, knockouts),
    [tournamentForCompute, entriesForCompute, knockouts],
  );
  const compByPlayer = useMemo(
    () => new Map(computed.map(c => [c.player_id, c])),
    [computed],
  );

  // Regular (non-bounty) pool: buy-ins/rebuys + add-on fees. Matches dashboard stats.
  const placementPool = useMemo(
    () => entriesForCompute.reduce(
      (s, e) => s + e.buy_ins * tournament.buy_in_amount + (e.addons ?? 0) * addonPrice,
      0,
    ),
    [entriesForCompute, tournament.buy_in_amount, addonPrice],
  );
  const bountyPool = isPko
    ? entriesForCompute.reduce((s, e) => s + e.buy_ins * (tournament.bounty_start_amount ?? 0), 0)
    : 0;
  const prizePool = placementPool + bountyPool;

  const structurePayouts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of tournament.payout_structure) m.set(s.position, (s.pct / 100) * placementPool);
    return m;
  }, [placementPool, tournament.payout_structure]);

  // PKO: replay the knockout ledger to get each player's bounty cash won and
  // knockout count. The champion (1st place) cashes their own final bounty, so
  // pass them in for an accurate total.
  const champion = entries.find(e => e.finish_position === 1)?.player_id ?? null;
  const bountyByPlayer = useMemo(() => {
    if (!isPko) return null;
    return computeBountyState(entries.map(e => e.player_id), knockouts, bountyConfig(tournament), champion).byPlayer;
  }, [isPko, entries, knockouts, tournament, champion]);

  const bountyWonOf = (e: SummaryEntry) => compByPlayer.get(e.player_id)?.bounty_won ?? 0;
  const koCountOf = (e: SummaryEntry) => bountyByPlayer?.get(e.player_id)?.koCount ?? 0;

  const placementPayoutOf = (e: SummaryEntry) => compByPlayer.get(e.player_id)?.payout ?? 0;
  const payoutOf = (e: SummaryEntry) => placementPayoutOf(e) + bountyWonOf(e);

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
    if (e.finish_position != null && placementPayoutOf(e) > 0) paidSet.add(e.finish_position);
  }
  const paidPositions = [...paidSet].sort((a, b) => a - b);
  const podium = paidPositions.map(position => {
    const e = finisherAt.get(position) ?? null;
    return {
      position,
      name: e ? (nameById.get(e.player_id) ?? "Unknown") : "—",
      amount: e ? placementPayoutOf(e) : (structurePayouts.get(position) ?? 0),
      bounty: e ? bountyWonOf(e) : 0,
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
          but without the description band so the value reads big. When a photo
          is present it sits on the left on desktop with the four tiles as a 2×2
          grid on the right (stretched to match the square photo's height); on
          mobile the photo stacks on top and the tiles fall to a 2×2 grid below. */}
      <div className={`flex flex-col gap-2 sm:gap-3 ${tournament.image_url ? "sm:flex-row sm:items-stretch" : ""}`}>
        {tournament.image_url && (
          <div className="w-full shrink-0 overflow-hidden rounded-card border border-[var(--border)] sm:w-64">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tournament.image_url}
              alt={`${title} photo`}
              className="aspect-square w-full object-cover"
              style={{ objectPosition: imageObjectPosition(tournament.image_focus_x, tournament.image_focus_y) }}
            />
          </div>
        )}
        <div className={`grid flex-1 grid-cols-2 gap-2 sm:gap-3 ${tournament.image_url ? "sm:grid-rows-2" : "lg:grid-cols-4"}`}>
          <MetricTile label="Prize pool" value={`€${prizePool.toFixed(2)}`} icon={<IconWallet />} accent="emerald" showDescription={false} />
          <MetricTile label="Players" value={String(playerCount)} icon={<IconUsers />} accent="sky" showDescription={false} />
          <MetricTile label="Buy-in" value={eur(tournament.buy_in_amount + (isPko ? (tournament.bounty_start_amount ?? 0) : 0))} icon={<IconCoin />} accent="emerald" showDescription={false} />
          <MetricTile label="Total buy-ins" value={String(totalBuyIns)} icon={<IconCoin />} accent="amber" showDescription={false} />
        </div>
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
                  {row.bounty > 0 ? (
                    <div className="text-sm muted leading-tight">
                      <div>{eur(row.amount + row.bounty)}</div>
                      <div className="text-xs">(incl. {eur(row.bounty)} in bounties)</div>
                    </div>
                  ) : (
                    <div className="text-sm muted">{eur(row.amount)}</div>
                  )}
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
                {showAddons && <th className="text-center">Add-ons</th>}
                <th className="hidden md:table-cell">Cost</th>
                {isPko && <th className="text-center">KOs</th>}
                {isPko && <th className="hidden sm:table-cell">Bounty</th>}
                <th>Payout</th>
                <th className="hidden md:table-cell">Net</th>
              </tr>
            </thead>
            <tbody>
              {standings.map(e => {
                const c = compByPlayer.get(e.player_id);
                const cost = c?.cost ?? 0;
                const bountyWon = bountyWonOf(e);
                const koCount = koCountOf(e);
                const payout = payoutOf(e);
                const net = c?.net ?? payout - cost;
                const addons = e.addons ?? c?.addons ?? 0;
                return (
                  <tr key={e.player_id}>
                    <td>{e.finish_position != null ? ordinal(e.finish_position) : <span className="muted">—</span>}</td>
                    <td>{nameById.get(e.player_id) ?? <span className="muted">Unknown</span>}</td>
                    <td>{e.buy_ins}</td>
                    {showAddons && (
                      <td className="text-center">{addons > 0 ? addons : <span className="muted">—</span>}</td>
                    )}
                    <td className="hidden md:table-cell">{eur(cost)}</td>
                    {isPko && <td className="text-center">{koCount > 0 ? formatKoCount(koCount) : <span className="muted">—</span>}</td>}
                    {isPko && <td className="hidden sm:table-cell">{bountyWon > 0 ? eur(bountyWon) : <span className="muted">—</span>}</td>}
                    <td>{payout > 0 ? eur(payout) : <span className="muted">—</span>}</td>
                    <td className={`hidden md:table-cell ${net >= 0 ? "pos" : "neg"}`}>{eur(net)}</td>
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

