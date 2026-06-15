"use client";
import useSWR from "swr";
import Link from "next/link";
import type { Tournament } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { useSortable, SortableTh, type SortDir } from "@/components/sortable";

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

// Comparable value per sortable column, shared by the Active and Finished
// tables. Missing location/winner return null so those rows sink to the bottom.
function tournamentSortValue(t: TournamentRow, key: string): number | string | null {
  switch (key) {
    case "date": return t.date;
    case "name": return (t.display_name ?? (t.name ?? "").trim()).toLowerCase();
    case "location": return t.location_name ? t.location_name.toLowerCase() : null;
    case "winner": return t.winner_name ? t.winner_name.toLowerCase() : null;
    case "players": return t.player_count ?? 0;
    case "pool": return t.prize_pool ?? 0;
    case "buy_in": return t.buy_in_amount;
    default: return null;
  }
}
const T_SORT_DIRS: Record<string, SortDir> = {
  date: "desc", name: "asc", location: "asc", winner: "asc",
  players: "desc", pool: "desc", buy_in: "desc",
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

  // Independent sort state per table. Default "date desc" with a stable
  // tiebreak preserves the server ordering (date desc, created_at desc) on
  // first render.
  const activeSort = useSortable<TournamentRow>(active, tournamentSortValue, { initialKey: "date", defaultDirs: T_SORT_DIRS });
  const finishedSort = useSortable<TournamentRow>(finished, tournamentSortValue, { initialKey: "date", defaultDirs: T_SORT_DIRS });

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
                  <SortableTh k="date" label="Date" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <SortableTh k="name" label="Name" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <SortableTh k="location" label="Location" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <SortableTh k="players" label="Players" className="hidden sm:table-cell" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <SortableTh k="pool" label="Pool so far" className="hidden sm:table-cell" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <SortableTh k="buy_in" label="Buy-in" className="hidden sm:table-cell" sortKey={activeSort.sortKey} sortDir={activeSort.sortDir} onSort={activeSort.onSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeSort.sorted.map(t => {
                  const displayName = t.display_name
                    ?? ((t.name ?? "").trim() || (t.order_number ? `Tournament #${t.order_number}` : "Tournament"));
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
                  <SortableTh k="date" label="Date" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <SortableTh k="name" label="Name" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  {/* Location is mandatory for new tournaments, so it earns a
                      permanent spot in the mobile layout. Winner / pool / etc.
                      remain hidden on small screens to keep the row readable. */}
                  <SortableTh k="location" label="Location" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <SortableTh k="winner" label="Winner" className="hidden sm:table-cell" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <SortableTh k="players" label="Players" className="hidden sm:table-cell" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <SortableTh k="pool" label="Pool" className="hidden sm:table-cell" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <SortableTh k="buy_in" label="Buy-in" className="hidden sm:table-cell" sortKey={finishedSort.sortKey} sortDir={finishedSort.sortDir} onSort={finishedSort.onSort} />
                  <th className="hidden sm:table-cell">Payouts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {finishedSort.sorted.map(t => {
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
