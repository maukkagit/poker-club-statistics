"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Tournament } from "@/lib/types";

export default function TournamentsListPage() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/tournaments").then(r => r.json()).then(d => { setItems(d); setLoading(false); });
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tournaments</h1>
        <Link href="/tournaments/new" className="btn">+ New</Link>
      </div>
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : items.length === 0 ? <div className="muted">No tournaments yet.</div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Name</th><th>Buy-in</th><th>Payouts</th><th></th></tr></thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.name}</td>
                  <td>€{t.buy_in_amount}</td>
                  <td className="muted">{t.payout_structure.map(p => `${p.position}:${p.pct}%`).join(" · ")}</td>
                  <td><Link className="link" href={`/tournaments/${t.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
