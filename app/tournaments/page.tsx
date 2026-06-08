"use client";
import useSWR from "swr";
import Link from "next/link";
import type { Tournament } from "@/lib/types";
import { apiKeys } from "@/lib/api";

export default function TournamentsListPage() {
  const { data, isLoading } = useSWR<Tournament[]>(apiKeys.tournaments);
  const items = data ?? [];
  const loading = isLoading && !data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tournaments</h1>
        <Link href="/tournaments/new" className="btn">+ New</Link>
      </div>
      <div className="card overflow-x-auto">
        {loading ? <div className="muted">Loading…</div> : items.length === 0 ? <div className="muted">No tournaments yet.</div> : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th className="hidden sm:table-cell">Buy-in</th>
                <th className="hidden sm:table-cell">Payouts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{t.date}</td>
                  <td>{t.name}</td>
                  <td className="hidden sm:table-cell">€{t.buy_in_amount}</td>
                  <td className="muted hidden sm:table-cell">{t.payout_structure.map(p => `${p.position}:${p.pct}%`).join(" · ")}</td>
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
