"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import type { Player, PlayerStats } from "@/lib/types";

type Point = { date: string; tournamentId: string } & Record<string, number | string>;

const COLORS = ["#4ade80","#60a5fa","#f472b6","#fbbf24","#a78bfa","#34d399","#f87171","#22d3ee","#fb923c","#e879f9","#94a3b8","#facc15","#2dd4bf","#fb7185","#c084fc"];

function fmtEur(n: number) { return `${n >= 0 ? "+" : ""}€${n.toFixed(2)}`; }

export default function Dashboard() {
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(d => {
      setStats(d.stats); setPlayers(d.series.players); setPoints(d.series.points);
      const init: Record<string, boolean> = {};
      // enable top-8 by net profit by default
      const top = [...d.stats].sort((a: PlayerStats, b: PlayerStats) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 8);
      for (const s of top) init[s.player_id] = true;
      setEnabled(init);
      setLoading(false);
    });
  }, []);

  const activeIds = useMemo(() => players.filter(p => enabled[p.id]).map(p => p.id), [players, enabled]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="muted text-sm">Cumulative net profit over time. Toggle players to compare.</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-2 mb-3">
          {players.map((p, i) => (
            <button key={p.id}
              onClick={() => setEnabled(s => ({ ...s, [p.id]: !s[p.id] }))}
              className="px-2 py-1 rounded text-xs"
              style={{
                background: enabled[p.id] ? COLORS[i % COLORS.length] : "transparent",
                color: enabled[p.id] ? "#0b1020" : "var(--muted)",
                border: `1px solid ${enabled[p.id] ? COLORS[i % COLORS.length] : "var(--border)"}`,
              }}>{p.name}</button>
          ))}
        </div>
        <div style={{ width: "100%", height: 380 }}>
          {points.length === 0 ? (
            <div className="muted">{loading ? "Loading…" : "No tournaments yet."}</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={points} margin={{ left: 4, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="#243056" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#8a93b2" fontSize={12} />
                <YAxis stroke="#8a93b2" fontSize={12} tickFormatter={(v) => `€${v}`} />
                <Tooltip contentStyle={{ background: "#131a33", border: "1px solid #243056" }} formatter={(v: any, name: any) => [`€${Number(v).toFixed(2)}`, players.find(p => p.id === name)?.name ?? name]} />
                {activeIds.map((pid, i) => (
                  <Line key={pid} type="monotone" dataKey={pid} stroke={COLORS[players.findIndex(p => p.id === pid) % COLORS.length]} strokeWidth={2} dot={false} />
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
              <th>#</th><th>Player</th><th>Tournaments</th><th>Buy-ins</th>
              <th>Total cost</th><th>Total winnings</th><th>Net profit</th><th>Avg / tourn.</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.player_id}>
                <td>{i + 1}</td>
                <td>{s.name}</td>
                <td>{s.tournaments}</td>
                <td>{s.total_buy_ins}</td>
                <td>€{s.total_cost.toFixed(2)}</td>
                <td>€{s.total_winnings.toFixed(2)}</td>
                <td className={s.net_profit >= 0 ? "pos" : "neg"}>{fmtEur(s.net_profit)}</td>
                <td className={s.avg_net >= 0 ? "pos" : "neg"}>{fmtEur(s.avg_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
