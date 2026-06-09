"use client";
import useSWR from "swr";
import Link from "next/link";
import type { Tournament } from "@/lib/types";
import { apiKeys } from "@/lib/api";

type TournamentRow = Tournament & {
  winner_name?: string | null;
  player_count?: number;
  prize_pool?: number;
  location_name?: string | null;
  // Pre-resolved by the API: the user-supplied name when present, otherwise
  // "Tournament #N" where N is the chronological order number.
  order_number?: number | null;
  display_name?: string;
};

export default function TournamentsListPage() {
  const { data, isLoading } = useSWR<TournamentRow[]>(apiKeys.tournaments);
  const items = data ?? [];
  const loading = isLoading && !data;

  // Split the list into in-progress vs final games. The Active section
  // only renders when there's at least one row to avoid an empty box.
  // The single "+ New tournament" entry point lives in the global header
  // (which opens the Active / Finished chooser), so this page no longer
  // owns an add button of its own.
  const active = items.filter(t => t.state === "Active");
  const finished = items.filter(t => t.state !== "Active");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tournaments</h1>

      {active.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Active tournaments</h2>
            <span className="muted text-sm">{active.length} in progress</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th className="hidden sm:table-cell">Players</th>
                  <th className="hidden sm:table-cell">Pool so far</th>
                  <th className="hidden sm:table-cell">Buy-in</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map(t => {
                  const displayName = t.display_name
                    ?? ((t.name ?? "").trim() || "Active tournament");
                  const usingFallback = !((t.name ?? "").trim());
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{t.date}</td>
                      <td className={usingFallback ? "muted" : ""}>{displayName}</td>
                      <td className={t.location_name ? "" : "muted"}>{t.location_name ?? "—"}</td>
                      <td className="hidden sm:table-cell">{t.player_count ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.prize_pool ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.buy_in_amount}</td>
                      <td>
                        <Link className="link" href={`/tournaments/${t.id}`}>Continue</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        {/* Only label this section explicitly when an Active section is
            also present — otherwise the H1 "Tournaments" above is label
            enough and a sub-heading just adds visual noise. */}
        {active.length > 0 && (
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Finished tournaments</h2>
            <span className="muted text-sm">{finished.length} total</span>
          </div>
        )}
        <div className="card overflow-x-auto">
          {loading ? <div className="muted">Loading…</div> : finished.length === 0 ? <div className="muted">No finished tournaments yet.</div> : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Name</th>
                  {/* Location is mandatory for new tournaments, so it earns a
                      permanent spot in the mobile layout. Winner / pool / etc.
                      remain hidden on small screens to keep the row readable. */}
                  <th>Location</th>
                  <th className="hidden sm:table-cell">Winner</th>
                  <th className="hidden sm:table-cell">Players</th>
                  <th className="hidden sm:table-cell">Pool</th>
                  <th className="hidden sm:table-cell">Buy-in</th>
                  <th className="hidden sm:table-cell">Payouts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {finished.map(t => {
                  // Prefer the API-resolved display_name (with "Tournament #N"
                  // fallback). Defensive fallback for older clients / cached
                  // responses that may predate the enrichment.
                  const displayName = t.display_name
                    ?? ((t.name ?? "").trim() || (t.order_number ? `Tournament #${t.order_number}` : "Tournament"));
                  const usingFallback = !((t.name ?? "").trim());
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{t.date}</td>
                      <td className={usingFallback ? "muted" : ""}>
                        <span className="inline-flex items-center gap-1.5">
                          {t.special && (
                            // Amber star before the name marks "Special"
                            // tournaments on every viewport. We dropped the
                            // separate desktop pill because it crowded the
                            // name column without adding information the star
                            // doesn't already convey.
                            <span
                              aria-label="Special tournament"
                              title="Special tournament"
                              className="text-amber-400 leading-none"
                            >
                              ★
                            </span>
                          )}
                          {displayName}
                        </span>
                      </td>
                      <td className={t.location_name ? "" : "muted"}>{t.location_name ?? "—"}</td>
                      <td className={`hidden sm:table-cell ${t.winner_name ? "" : "muted"}`}>{t.winner_name ?? "—"}</td>
                      <td className="hidden sm:table-cell">{t.player_count ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.prize_pool ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.buy_in_amount}</td>
                      <td className="muted hidden sm:table-cell">{t.payout_structure.map(p => `${p.position}:${Math.round(p.pct)}%`).join(" · ")}</td>
                      <td><Link className="link" href={`/tournaments/${t.id}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
