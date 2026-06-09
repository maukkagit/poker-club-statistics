"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useParams } from "next/navigation";
import type { Player, PlayerStats } from "@/lib/types";
import { apiKeys, ApiError } from "@/lib/api";

type HistoryRow = {
  tournament_id: string;
  date: string;
  name: string;
  display_name: string;
  state: string;
  special: boolean;
  location_name: string | null;
  buy_ins: number;
  finish_position: number | null;
  payout: number;
  cost: number;
  net: number;
};

type PlayerDetail = {
  player: Player;
  stats: PlayerStats;
  tournaments: HistoryRow[];
};

const fmtEur = (n: number) => `${n >= 0 ? "+" : ""}€${n.toFixed(2)}`;
const eur = (n: number) => `€${n.toFixed(2)}`;
const roiPct = (s: PlayerStats): number | null =>
  s.total_cost > 0 ? (s.net_profit / s.total_cost) * 100 : null;

// Compact ordinal suffix for finish positions ("1st", "2nd", "11th", …).
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  // Mirror the dashboard toggle here so the per-player tiles and history
  // table can opt special tournaments in/out. Default off, matching the
  // dashboard's first-load behaviour.
  const [includeSpecial, setIncludeSpecial] = useState(false);
  const { data, error, isLoading } = useSWR<PlayerDetail>(apiKeys.player(id, includeSpecial));

  const roi = useMemo(() => (data ? roiPct(data.stats) : null), [data]);

  if (error) {
    const msg = error instanceof ApiError && error.status === 404
      ? "Player not found"
      : (error as Error).message ?? "Failed to load player";
    return <div className="card neg">{msg}</div>;
  }
  if (isLoading || !data) return <div className="muted">Loading…</div>;

  const { player, stats, tournaments } = data;

  return (
    <div className="space-y-6">
      {/* Header: back link, player name, special-toggle. Wraps on narrow
          viewports so the title remains the focal point. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/players" className="link text-sm">← Players</Link>
          <h1 className="text-2xl font-bold">{player.name}</h1>
        </div>
        <label
          className="flex items-center gap-2 text-xs sm:text-sm cursor-pointer select-none"
          title="Special tournaments are off-format / themed events. They're excluded by default to keep regular-game stats comparable."
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-amber-400 cursor-pointer"
            checked={includeSpecial}
            onChange={e => setIncludeSpecial(e.target.checked)}
          />
          <span>Include special tournaments</span>
        </label>
      </div>

      {/* Stat tiles. Mirror the dashboard's player-row columns so the
          numbers are immediately recognisable to anyone who's seen the
          leaderboard. */}
      <div className="card grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Tile label="Tournaments" value={String(stats.tournaments)} />
        <Tile
          label="ITM"
          value={stats.tournaments > 0
            ? `${Math.round((stats.itm_count / stats.tournaments) * 100)}%`
            : "—"}
          sub={stats.tournaments > 0 ? `${stats.itm_count} / ${stats.tournaments}` : undefined}
        />
        <Tile label="Buy-ins" value={String(stats.total_buy_ins)} />
        <Tile label="Total cost" value={eur(stats.total_cost)} />
        <Tile label="Total winnings" value={eur(stats.total_winnings)} />
        <Tile
          label="Net profit"
          value={fmtEur(stats.net_profit)}
          tone={stats.net_profit >= 0 ? "pos" : "neg"}
        />
        <Tile
          label="Avg / tournament"
          value={fmtEur(stats.avg_net)}
          tone={stats.avg_net >= 0 ? "pos" : "neg"}
        />
        <Tile
          label="ROI"
          value={roi == null ? "—" : `${roi >= 0 ? "+" : ""}${Math.round(roi)}%`}
          tone={roi == null ? undefined : roi >= 0 ? "pos" : "neg"}
        />
      </div>

      {/* Tournament history. Newest-first. Each row links into the
          tournament edit page so the user can drill from the player
          back to the source data. */}
      <div className="card overflow-x-auto">
        <h2 className="text-lg font-semibold mb-2">Tournament history</h2>
        {tournaments.length === 0 ? (
          <div className="muted">
            {player.name} hasn&apos;t played any{includeSpecial ? "" : " regular"} tournaments yet.
            {!includeSpecial && " Try enabling \u201CInclude special tournaments\u201D."}
          </div>
        ) : (
          <table className="table whitespace-nowrap">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th className="hidden sm:table-cell">Location</th>
                <th className="text-center">Finish</th>
                <th className="text-center">Buy-ins</th>
                <th className="text-center hidden sm:table-cell">Cost</th>
                <th className="text-center hidden sm:table-cell">Payout</th>
                <th className="text-center">Net</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map(t => (
                <tr key={t.tournament_id}>
                  <td className="whitespace-nowrap">{t.date}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/tournaments/${t.tournament_id}`} className="link">
                        {t.display_name}
                      </Link>
                      {t.special && (
                        <span
                          className="text-[0.7rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border whitespace-nowrap"
                          style={{
                            color: "rgb(251 191 36)",
                            borderColor: "rgb(251 191 36 / 0.4)",
                            background: "rgb(251 191 36 / 0.12)",
                          }}
                        >
                          Special
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`hidden sm:table-cell ${t.location_name ? "" : "muted"}`}>
                    {t.location_name ?? "—"}
                  </td>
                  <td className="text-center">
                    {t.finish_position == null ? <span className="muted">—</span> : ordinal(t.finish_position)}
                  </td>
                  <td className="text-center">{t.buy_ins}</td>
                  <td className="text-center hidden sm:table-cell">{eur(t.cost)}</td>
                  <td className="text-center hidden sm:table-cell">
                    {t.payout > 0 ? eur(t.payout) : <span className="muted">—</span>}
                  </td>
                  <td className={`text-center ${t.net >= 0 ? "pos" : "neg"}`}>{fmtEur(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Mini-tile component shared by the summary card above. Kept local
// (rather than imported from the dashboard) to avoid coupling — the
// dashboard's Tile has a richer accent system this page doesn't need.
function Tile({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-xl",
        "border border-white/[0.05]",
        "bg-gradient-to-b from-[#1a224a] to-[#0e1430]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        "px-3 py-3 sm:px-3.5 sm:py-3.5",
        "flex flex-col gap-0.5",
      ].join(" ")}
    >
      <div className="text-[0.7rem] sm:text-xs uppercase tracking-normal sm:tracking-[0.08em] font-semibold leading-tight muted break-words">
        {label}
      </div>
      <div className={`text-xl sm:text-[1.7rem] font-bold leading-tight tracking-tight tabular-nums break-words ${tone === "pos" ? "pos" : tone === "neg" ? "neg" : ""}`}>
        {value}
      </div>
      <div className="text-[0.7rem] sm:text-xs leading-tight muted break-words min-h-[1em]">
        {sub ?? "\u00A0"}
      </div>
    </div>
  );
}
