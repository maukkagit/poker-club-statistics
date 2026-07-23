"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { Tournament } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { useSortable, SortableTh, type SortDir } from "@/components/sortable";
import { Skeleton } from "@/components/ui/Skeleton";

// Finished tournaments are paginated client-side: the API returns the full
// enriched list in one request (enrichment needs every entry + chronological
// order numbers), so sorting still applies across the whole set — we just cap
// how many rows render at once. Default sort is date-desc, so the first page
// is the latest 50.
const PAGE_SIZE = 50;

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
  const router = useRouter();
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

  // Client-side pagination over the (sorted) finished list. We render the
  // first `visibleCount` rows and reveal more in PAGE_SIZE chunks. Changing
  // the sort re-orders the full set first, so the visible window always shows
  // the top N for the current sort.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const totalFinished = finishedSort.sorted.length;
  // Clamp back down if the dataset shrinks (e.g. a tournament is deleted) so we
  // never claim to show more rows than exist.
  useEffect(() => {
    setVisibleCount(c => Math.min(Math.max(c, PAGE_SIZE), Math.max(totalFinished, PAGE_SIZE)));
  }, [totalFinished]);
  const visibleFinished = useMemo(
    () => finishedSort.sorted.slice(0, visibleCount),
    [finishedSort.sorted, visibleCount],
  );
  const shownCount = Math.min(visibleCount, totalFinished);
  const hasMore = visibleCount < totalFinished;

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
                </tr>
              </thead>
              <tbody>
                {activeSort.sorted.map(t => {
                  const displayName = t.display_name
                    ?? ((t.name ?? "").trim() || (t.order_number ? `Tournament #${t.order_number}` : "Tournament"));
                  const usingFallback = !((t.name ?? "").trim());
                  const href = `/tournaments/${t.id}`;
                  return (
                    <tr
                      key={t.id}
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => router.push(href)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap">{t.date}</td>
                      <td className={usingFallback ? "muted" : ""}>{displayName}</td>
                      <td className={t.location_name ? "" : "muted"}>{t.location_name ?? "—"}</td>
                      <td className="hidden sm:table-cell">{t.player_count ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.prize_pool ?? 0}</td>
                      <td className="hidden sm:table-cell">€{t.buy_in_amount}</td>
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
        {/* When there's no Active section the page has no sub-heading, so a
            standalone count line keeps the "X of Y" context visible. */}
        {active.length === 0 && !loading && totalFinished > 0 && (
          <div className="muted text-sm">{finished.length} tournament{finished.length === 1 ? "" : "s"}</div>
        )}
        <div className="card overflow-x-auto">
          {loading ? <TableLoading /> : finished.length === 0 ? (
            <EmptyState
              title="No finished tournaments yet"
              hint="Completed games will appear here once you wrap up a tournament."
            />
          ) : (
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
                </tr>
              </thead>
              <tbody>
                {visibleFinished.map(t => {
                  // Prefer the API-resolved display_name (with "Tournament #N"
                  // fallback). Defensive fallback for older clients / cached
                  // responses that may predate the enrichment.
                  const displayName = t.display_name
                    ?? ((t.name ?? "").trim() || (t.order_number ? `Tournament #${t.order_number}` : "Tournament"));
                  const usingFallback = !((t.name ?? "").trim());
                  const href = `/tournaments/${t.id}`;
                  return (
                    <tr
                      key={t.id}
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => router.push(href)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                    >
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* Pagination footer: a "Showing X of Y" status plus a Load-more
            control. Hidden while the dataset fits on a single page so the
            footer only appears when it does something. */}
        {!loading && totalFinished > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="muted text-sm">
              Showing {shownCount} of {totalFinished}
            </span>
            <div className="flex items-center gap-3">
              {hasMore && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, totalFinished))}
                >
                  Load {Math.min(PAGE_SIZE, totalFinished - visibleCount)} more
                </button>
              )}
              {hasMore && (
                <button type="button" className="link text-sm" onClick={() => setVisibleCount(totalFinished)}>
                  Show all
                </button>
              )}
              {!hasMore && visibleCount > PAGE_SIZE && (
                <button type="button" className="link text-sm" onClick={() => setVisibleCount(PAGE_SIZE)}>
                  Show less
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// Loading placeholder for the finished-tournaments table: a short stack of
// shimmer rows that occupies the same vertical rhythm as real rows, so the
// card doesn't collapse then jump when data arrives.
function TableLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

// Friendly empty state: a soft accent-tinted icon, a heading, and a hint —
// replaces the bare muted "No …" one-liner.
function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full text-accent"
        style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
        aria-hidden="true"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4Z" />
          <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
        </svg>
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="muted text-sm max-w-sm">{hint}</p>}
    </div>
  );
}
