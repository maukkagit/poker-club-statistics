"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import type { Player, PlayerStats, TournamentSummary } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { Toggle } from "@/components/ui";
import { useSortable, SortableTh } from "@/components/sortable";
import {
  MetricTile as Tile,
  ACCENT_CLASSES,
  type Accent,
  IconCalendar,
  IconUsers,
  IconUsersPlus,
  IconWallet,
  IconCoin,
  IconTrendingUp,
  IconTrophy,
  IconAward,
  IconTarget,
} from "@/components/MetricTile";
import { eurRounded as eur0, oneDecimal as oneDp, eurSigned as fmtEur, roiPct } from "@/lib/format";

type Point = { date: string; tournamentId: string } & Record<string, number | string | null>;

type StatsResponse = {
  stats: PlayerStats[];
  series: {
    players: Player[];
    points: Point[];
    latestTournamentPlayerIds?: string[];
  };
  summary: TournamentSummary;
};

// Color generator: golden-ratio hue spacing (137.508°) combined with 5
// lightness bands × 3 saturation bands.
//
// Why the band sizes matter: with golden-ratio hue stepping, the small
// Fibonacci-like step counts (2, 3, 5, 8, 13, 21) produce the closest hue
// collisions modulo 360°. The two worst are step-8 (Δhue ≈ 20°) and step-21
// (Δhue ≈ 7.7°). Picking band lengths coprime with 8 (= 2³) and 21 (= 3·7)
// guarantees those collision pairs land on different L and S values, so they
// differ in brightness/saturation even when their hues are nearly identical.
// 5 and 3 satisfy that.
//
// The L and S values themselves are interleaved (not monotonic) so that
// adjacent alphabetical players also get visibly different brightnesses,
// which makes the legend row read as colourful instead of as a smooth gradient.
const GOLDEN_HUE = 137.508;
const L_BANDS = [45, 72, 90, 55, 78];
const S_BANDS = [68, 92, 80];
function colorForIndex(i: number): string {
  const hue = (i * GOLDEN_HUE) % 360;
  const l = L_BANDS[i % L_BANDS.length];
  const s = S_BANDS[i % S_BANDS.length];
  return `hsl(${hue.toFixed(1)} ${s}% ${l}%)`;
}

type SortKey = "name" | "tournaments" | "itm" | "buy_ins" | "cost" | "winnings" | "net" | "avg" | "roi";
type SortDir = "asc" | "desc";
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  tournaments: "desc",
  itm: "desc",
  buy_ins: "desc",
  cost: "desc",
  winnings: "desc",
  net: "desc",
  avg: "desc",
  roi: "desc",
};

export default function Dashboard() {
  // Off-format / themed tournaments live in the dataset but are excluded
  // from every aggregation by default. The user can flip this toggle to
  // include them in the chart, summary tiles and the player-stats table.
  // SWR caches each variant under its own key (see `apiKeys.stats`), so
  // toggling is instant after the first fetch of each side.
  const [includeSpecial, setIncludeSpecial] = useState(false);
  const { data, isLoading } = useSWR<StatsResponse>(apiKeys.stats(includeSpecial));
  const stats = data?.stats ?? [];
  const players = data?.series.players ?? [];
  const points = data?.series.points ?? [];
  const summary = data?.summary;

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  // Pre-select "latest tournament" players the first time the stats arrive in
  // this page mount. Without the ref this would re-run on every revalidation
  // and clobber user toggles.
  const enabledInitialized = useRef(false);
  useEffect(() => {
    if (enabledInitialized.current || !data) return;
    const latestIds: string[] = data.series.latestTournamentPlayerIds ?? [];
    const init: Record<string, boolean> = {};
    for (const id of latestIds) init[id] = true;
    setEnabled(init);
    enabledInitialized.current = true;
  }, [data]);

  const loading = isLoading && !data;

  // Canonical alphabetical order — used both to render the legend tags AND to
  // assign each player a stable color. Keying color off the sorted index keeps
  // colors stable as long as the roster doesn't change.
  //
  // Names starting with non-letter characters (e.g. "[Joniksen kämppis]") would
  // otherwise sort to the very top because punctuation has lower Unicode
  // codepoints than letters; bucket them to the bottom instead.
  const playersAlpha = useMemo(() => {
    const startsWithLetter = (s: string) => /^\p{L}/u.test(s);
    return [...players].sort((a, b) => {
      const al = startsWithLetter(a.name);
      const bl = startsWithLetter(b.name);
      if (al !== bl) return al ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [players]);
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    playersAlpha.forEach((p, i) => m.set(p.id, colorForIndex(i)));
    return m;
  }, [playersAlpha]);

  const activeIds = useMemo(
    () => playersAlpha.filter(p => enabled[p.id]).map(p => p.id),
    [playersAlpha, enabled],
  );

  // Split the legend into two groups so currently-selected players sit at the
  // top in their own row(s) and unselected ones can be hidden behind a toggle
  // on mobile. Both lists inherit the alphabetical order from `playersAlpha`.
  const selectedPlayers = useMemo(
    () => playersAlpha.filter(p => enabled[p.id]),
    [playersAlpha, enabled],
  );
  const unselectedPlayers = useMemo(
    () => playersAlpha.filter(p => !enabled[p.id]),
    [playersAlpha, enabled],
  );
  // Mobile-only: keep unselected pills collapsed until the user taps
  // "+ Add players". Desktop ignores this state because the unselected
  // section is always visible via `sm:flex`.
  const [showUnselected, setShowUnselected] = useState(false);

  // Player-stats table sort. Default = net descending (the server already
  // returns rows in that order, so first render matches without re-sorting).
  // Each key has a sensible default direction so a single click does the
  // expected thing (numbers descend, names ascend). `itm` and `roi` return
  // null for undefined cases (0 tournaments / 0 cost) so those rows pin to the
  // bottom regardless of direction instead of floating up on an "asc" sort.
  const { sorted: sortedStats, sortKey, sortDir, onSort } = useSortable<PlayerStats>(
    stats,
    (s, key) => {
      switch (key) {
        case "name": return s.name.toLowerCase();
        case "tournaments": return s.tournaments;
        case "itm": return s.tournaments > 0 ? s.itm_count / s.tournaments : null;
        case "buy_ins": return s.total_buy_ins;
        case "cost": return s.total_cost;
        case "winnings": return s.total_winnings;
        case "net": return s.net_profit;
        case "avg": return s.avg_net;
        case "roi": return roiPct(s);
        default: return null;
      }
    },
    { initialKey: "net", defaultDirs: DEFAULT_SORT_DIR, tiebreak: (a, b) => a.name.localeCompare(b.name) },
  );

  // X-axis range: start at the earliest tournament where any *selected* player
  // has data. Computed by scanning forward through points until we find the
  // first index where at least one active player's value is non-null.
  const visiblePoints = useMemo(() => {
    if (activeIds.length === 0 || points.length === 0) return [];
    const firstIdx = points.findIndex(pt =>
      activeIds.some(id => pt[id] !== null && pt[id] !== undefined),
    );
    return firstIdx === -1 ? [] : points.slice(firstIdx);
  }, [points, activeIds]);

  return (
    <div className="space-y-6">
      {/* Header row: title on the left, "Include special tournaments"
          toggle on the right. Wraps to its own row on narrow viewports so
          the title stays visually prominent. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Toggle
          checked={includeSpecial}
          onChange={setIncludeSpecial}
          label="Include special tournaments"
          size="sm"
          // Compact on mobile (~10px label, ~17px track from the `sm` Toggle
          // size) so the dashboard title and the toggle fit on one line at
          // a 390px viewport. Bumps to the normal `text-sm` from `sm:` up.
          className="text-[0.7rem] sm:text-sm"
        />
      </div>

      {summary && summary.total_tournaments > 0 && <SummaryCard s={summary} />}

      <div className="card">
        <h2 className="text-lg font-semibold">Cumulative net profit</h2>
        <p className="muted text-sm mb-3">Cumulative net profit over time. Toggle players to compare.</p>
        {/* Two-section player legend.
            "Selected" pills are always visible — tap to deselect.
            "Unselected" pills are always visible on desktop, but collapsed on
            mobile under an "+ Add players" toggle to save vertical space. */}
        <div className="flex flex-wrap gap-1 sm:gap-2 mb-2">
          {selectedPlayers.length === 0 ? (
            <span className="muted text-[0.7rem] sm:text-xs">No players selected</span>
          ) : (
            selectedPlayers.map(p => {
              const color = colorById.get(p.id)!;
              return (
                <button key={p.id}
                  onClick={() => setEnabled(s => ({ ...s, [p.id]: !s[p.id] }))}
                  className="px-1.5 py-0.5 rounded text-[0.7rem] sm:px-2 sm:py-1 sm:text-xs"
                  style={{
                    background: color,
                    color: "#0b1020",
                    border: `1px solid ${color}`,
                  }}>{p.name}</button>
              );
            })
          )}
        </div>
        {unselectedPlayers.length > 0 && (
          <button
            type="button"
            onClick={() => setShowUnselected(s => !s)}
            className="sm:hidden link text-[0.7rem] mb-2"
          >
            {showUnselected ? "Hide" : `+ Add players (${unselectedPlayers.length})`}
          </button>
        )}
        <div className={`flex-wrap gap-1 sm:gap-2 mb-3 ${showUnselected ? "flex" : "hidden sm:flex"}`}>
          {unselectedPlayers.map(p => {
            const color = colorById.get(p.id)!;
            return (
              <button key={p.id}
                onClick={() => setEnabled(s => ({ ...s, [p.id]: !s[p.id] }))}
                className="px-1.5 py-0.5 rounded text-[0.7rem] sm:px-2 sm:py-1 sm:text-xs"
                style={{
                  background: "transparent",
                  color: "var(--muted)",
                  border: `1px solid var(--border)`,
                }}>{p.name}</button>
            );
          })}
        </div>
        {/* Visible date range badge — gives instant feedback when toggling
            players changes the chart's left edge, since it can otherwise be
            subtle if any "founding member" stays selected. */}
        {visiblePoints.length > 0 && (
          <div className="muted text-xs mb-2">
            Range: {visiblePoints[0].date} → {visiblePoints[visiblePoints.length - 1].date}
            {" · "}{visiblePoints.length} of {points.length} tournament{points.length === 1 ? "" : "s"}
          </div>
        )}
        <div style={{ width: "100%", height: 380 }}>
          {points.length === 0 ? (
            <div className="muted">{loading ? "Loading…" : "No tournaments yet."}</div>
          ) : activeIds.length === 0 ? (
            <div className="muted">Select at least one player to view the chart.</div>
          ) : visiblePoints.length === 0 ? (
            <div className="muted">The selected player{activeIds.length === 1 ? " hasn't" : "s haven't"} played any tournaments yet.</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={visiblePoints} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="#243056" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#8a93b2" fontSize={12} />
                {/* Compact y-axis: `k` suffix for thousands and a smaller
                    fixed width hand more horizontal space to the actual
                    chart lines on mobile (where every pixel counts). */}
                <YAxis
                  stroke="#8a93b2"
                  fontSize={11}
                  width={44}
                  tickFormatter={(v) => {
                    const n = Number(v);
                    const abs = Math.abs(n);
                    const sign = n < 0 ? "-" : "";
                    const body = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : String(abs);
                    return `${sign}€${body}`;
                  }}
                />
                <Tooltip
                  // Compact styling so the tooltip stays a small pop-over on a
                  // narrow phone screen instead of taking up half the chart.
                  contentStyle={{
                    background: "#131a33",
                    border: "1px solid #243056",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    lineHeight: 1.25,
                  }}
                  itemStyle={{ padding: 0, margin: 0 }}
                  labelStyle={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}
                  wrapperStyle={{ maxWidth: 220, zIndex: 5 }}
                  formatter={(v: any, name: any) => [
                    `€${Number(v).toFixed(2)}`,
                    players.find(p => p.id === name)?.name ?? name,
                  ]}
                />
                {activeIds.map(pid => (
                  <Line
                    key={pid}
                    type="monotone"
                    dataKey={pid}
                    stroke={colorById.get(pid)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card card-flat overflow-x-auto">
        <h2 className="text-lg font-semibold mb-2">Player stats</h2>
        {/* whitespace-nowrap on the table keeps every cell on a single line so
            row heights stay uniform even when a player name is long.

            Alignment policy: every column EXCEPT the player name (which
            stays left-aligned so long Finnish names read naturally) is
            centered for both header and body. The rank "#" column is also
            centered to match the surrounding numeric columns. */}
        <table className="table whitespace-nowrap">
          <thead>
            <tr>
              {/* "#" hidden on mobile — rank is already implied by row order. */}
              <th className="hidden sm:table-cell text-center">#</th>
              {/* The Player column is sticky so the player name stays visible
                  while the user scrolls the dense numeric columns horizontally
                  on a narrow viewport. */}
              <SortableTh k="name" label="Player" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="sticky-col" />
              <SortableTh k="tournaments" label="Tourn." align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="itm" label="ITM" align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="buy_ins" label="Buy-ins" align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="cost" label="Cost" align="center" className="hidden sm:table-cell" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="winnings" label="Winnings" align="center" className="hidden sm:table-cell" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="net" label="Net" align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="avg" label="Avg" align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh k="roi" label="ROI" align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sortedStats.map((s, i) => {
              const roi = roiPct(s);
              return (
                <tr key={s.player_id}>
                  <td className="hidden sm:table-cell text-center">{i + 1}</td>
                  <td className="sticky-col">
                    <Link href={`/players/${s.player_id}`} className="link">{s.name}</Link>
                  </td>
                  <td className="text-center">{s.tournaments}</td>
                  <td className="text-center">{s.tournaments > 0 ? `${Math.round((s.itm_count / s.tournaments) * 100)}%` : "—"}</td>
                  <td className="text-center">{s.total_buy_ins}</td>
                  <td className="text-center hidden sm:table-cell">€{s.total_cost.toFixed(2)}</td>
                  <td className="text-center hidden sm:table-cell">€{s.total_winnings.toFixed(2)}</td>
                  <td className={`text-center ${s.net_profit >= 0 ? "pos" : "neg"}`}>{fmtEur(s.net_profit)}</td>
                  <td className={`text-center ${s.avg_net >= 0 ? "pos" : "neg"}`}>{fmtEur(s.avg_net)}</td>
                  <td className={`text-center ${roi == null ? "" : roi >= 0 ? "pos" : "neg"}`}>
                    {roi == null ? "—" : `${roi >= 0 ? "+" : ""}${Math.round(roi)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Join a tournament's (possibly missing) name with its date for use as a
// tile sub-line. Tournaments can have a blank name, in which case we just
// show the date instead of an orphaned "· 2025-06-27" with a leading dot.
function joinNameDate(name: string | undefined | null, date: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? `${trimmed} · ${date}` : date;
}

function SummaryCard({ s }: { s: TournamentSummary }) {
  return (
    // Mobile uses a tighter inter-section gap so Money sits right under
    // Activity instead of feeling stranded. Desktop keeps the roomier
    // spacing where the wider viewport gives the sections plenty of air.
    <div className="card space-y-3 sm:space-y-6">
      {/* Card-level header. The subtitle quantifies the data set so the
          numbers below have immediate context ("over how many tournaments?"). */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">General stats</h2>
          <p className="text-xs sm:text-sm muted mt-0.5">
            All-time totals over {s.total_tournaments} tournament{s.total_tournaments === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <Section
        title="Activity"
        description="Tournaments and participation"
        accent="sky"
      >
        <Tile
          label="Total tournaments"
          value={String(s.total_tournaments)}
          icon={<IconCalendar />}
          accent="sky"
        />
        <Tile
          label="Avg players"
          value={oneDp(s.avg_player_count)}
          icon={<IconUsers />}
          accent="sky"
        />
        <Tile
          label="Largest field"
          value={s.biggest_field ? String(s.biggest_field.count) : "—"}
          sub={s.biggest_field ? joinNameDate(s.biggest_field.name, s.biggest_field.date) : undefined}
          icon={<IconUsersPlus />}
          accent="sky"
        />
      </Section>

      <Section
        title="Money"
        description="Prize pools, buy-ins, and standout wins"
        accent="emerald"
      >
        <Tile
          label="Total prize pool"
          value={eur0(s.total_prize_pool)}
          icon={<IconWallet />}
          accent="emerald"
        />
        <Tile
          label="Avg prize pool"
          value={eur0(s.avg_prize_pool)}
          icon={<IconTrendingUp />}
          accent="emerald"
        />
        <Tile
          label="Avg 1st-place payout"
          value={eur0(s.avg_win_amount)}
          icon={<IconTrophy />}
          accent="emerald"
        />
        <Tile
          label="Biggest prize pool"
          value={s.biggest_pool ? eur0(s.biggest_pool.amount) : "—"}
          sub={s.biggest_pool ? joinNameDate(s.biggest_pool.name, s.biggest_pool.date) : undefined}
          icon={<IconTrophy />}
          accent="amber"
        />
        <Tile
          label="Biggest single win"
          value={s.biggest_win ? eur0(s.biggest_win.amount) : "—"}
          sub={s.biggest_win ? `${s.biggest_win.player_name} · ${s.biggest_win.date}` : undefined}
          icon={<IconAward />}
          accent="amber"
        />
        <Tile
          label="Best ITM rate"
          value={s.best_itm_rate ? `${Math.round(s.best_itm_rate.itm_pct)}%` : "—"}
          sub={
            s.best_itm_rate
              ? `${s.best_itm_rate.player_name} · ${s.best_itm_rate.itm_count}/${s.best_itm_rate.played}`
              : "min 5 played"
          }
          icon={<IconTarget />}
          accent="amber"
        />
        <Tile
          label="Highest ROI"
          value={
            s.best_roi
              ? `${s.best_roi.roi_pct >= 0 ? "+" : ""}${Math.round(s.best_roi.roi_pct)}%`
              : "—"
          }
          sub={
            s.best_roi
              ? `${s.best_roi.player_name} · ${s.best_roi.played} played`
              : "min 5 played"
          }
          icon={<IconTrendingUp />}
          accent="amber"
        />
        <Tile
          label="Most buy-ins in 1 game"
          value={s.most_buy_ins ? String(s.most_buy_ins.count) : "—"}
          sub={s.most_buy_ins ? `${s.most_buy_ins.player_name} · ${s.most_buy_ins.date}` : undefined}
          icon={<IconCoin />}
          accent="amber"
        />
      </Section>
    </div>
  );
}

function Section({
  title, description, accent, children,
}: {
  title: string;
  description?: string;
  accent: Accent;
  children: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <section className="space-y-2 sm:space-y-3">
      {/* Section header. The colored dot ties the header to the icon badges
          on the tiles below, giving a quick at-a-glance grouping cue. */}
      <div className="flex items-baseline gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${a.dot}`} aria-hidden="true" />
        <h3 className="text-sm sm:text-base font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="text-[0.7rem] sm:text-xs muted hidden sm:block">· {description}</p>
        )}
      </div>
      {/* 3 columns on mobile so the small stat tiles can sit next to each
          other in a 390px viewport; widens to 4 columns from `lg` so larger
          screens use the space proportionally. */}
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {children}
      </div>
    </section>
  );
}


