"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import type { Player, PlayerStats } from "@/lib/types";
import { apiKeys } from "@/lib/api";

type Point = { date: string; tournamentId: string } & Record<string, number | string | null>;

type StatsResponse = {
  stats: PlayerStats[];
  series: {
    players: Player[];
    points: Point[];
    latestTournamentPlayerIds?: string[];
  };
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

function fmtEur(n: number) { return `${n >= 0 ? "+" : ""}€${n.toFixed(2)}`; }

export default function Dashboard() {
  const { data, isLoading } = useSWR<StatsResponse>(apiKeys.stats);
  const stats = data?.stats ?? [];
  const players = data?.series.players ?? [];
  const points = data?.series.points ?? [];

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
      <div>
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="muted text-sm">Cumulative net profit over time. Toggle players to compare.</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-2 mb-3">
          {playersAlpha.map(p => {
            const color = colorById.get(p.id)!;
            const isOn = !!enabled[p.id];
            return (
              <button key={p.id}
                onClick={() => setEnabled(s => ({ ...s, [p.id]: !s[p.id] }))}
                className="px-2 py-1 rounded text-xs"
                style={{
                  background: isOn ? color : "transparent",
                  color: isOn ? "#0b1020" : "var(--muted)",
                  border: `1px solid ${isOn ? color : "var(--border)"}`,
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
              <LineChart data={visiblePoints} margin={{ left: 4, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="#243056" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#8a93b2" fontSize={12} />
                <YAxis stroke="#8a93b2" fontSize={12} tickFormatter={(v) => `€${v}`} />
                <Tooltip contentStyle={{ background: "#131a33", border: "1px solid #243056" }} formatter={(v: any, name: any) => [`€${Number(v).toFixed(2)}`, players.find(p => p.id === name)?.name ?? name]} />
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

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Player stats</h2>
        <table className="table">
          <thead>
            <tr>
              {/* "#" hidden on mobile — rank is already implied by row order. */}
              <th className="hidden sm:table-cell">#</th>
              <th>Player</th>
              <th className="text-right">Tourn.</th>
              <th className="text-right">Buy-ins</th>
              <th className="text-right hidden sm:table-cell">Cost</th>
              <th className="text-right hidden sm:table-cell">Winnings</th>
              <th className="text-right">Net</th>
              <th className="text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.player_id}>
                <td className="hidden sm:table-cell">{i + 1}</td>
                <td>{s.name}</td>
                <td className="text-right">{s.tournaments}</td>
                <td className="text-right">{s.total_buy_ins}</td>
                <td className="text-right hidden sm:table-cell">€{s.total_cost.toFixed(2)}</td>
                <td className="text-right hidden sm:table-cell">€{s.total_winnings.toFixed(2)}</td>
                <td className={`text-right ${s.net_profit >= 0 ? "pos" : "neg"}`}>{fmtEur(s.net_profit)}</td>
                <td className={`text-right ${s.avg_net >= 0 ? "pos" : "neg"}`}>{fmtEur(s.avg_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
