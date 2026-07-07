"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { Tournament } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import { eurRounded } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { IconUsers, IconWallet, IconCoin, IconTrophy } from "@/components/MetricTile";

// The feed shows the newest finished tournaments as social-style cards, with
// any in-progress tournaments pinned on top in a distinct "live" treatment.
// Finished cards are paginated client-side (the API already returns the full
// enriched list in one request, so we just cap how many render at once).
const PAGE_SIZE = 20;

// Enriched row shape returned by /api/tournaments (see the route handler). The
// same shape powers the tournaments list page.
type TournamentRow = Tournament & {
  winner_name?: string | null;
  player_count?: number;
  prize_pool?: number;
  location_name?: string | null;
  order_number?: number | null;
  display_name?: string;
};

// Prefer the API-resolved display_name, falling back to the user name or a
// "Tournament #N" placeholder for older/cached responses that predate it.
function resolveName(t: TournamentRow): string {
  return (
    t.display_name
    ?? ((t.name ?? "").trim() || (t.order_number ? `Tournament #${t.order_number}` : "Tournament"))
  );
}

// Total prize pool including PKO bounty money. The row carries the buy-in pool
// (`prize_pool = totalBuyIns * buy_in_amount`), so we can back out the buy-in
// count and add each buy-in's starting bounty for PKO events — matching how the
// dashboard/general-stats figures now fold in bounty money.
function totalPool(t: TournamentRow): number {
  const buyInPool = t.prize_pool ?? 0;
  if (!t.is_pko || !t.buy_in_amount) return buyInPool;
  const buyIns = buyInPool / t.buy_in_amount;
  return buyInPool + buyIns * (t.bounty_start_amount ?? 0);
}

// The full price a player pays per entry. For PKO, `buy_in_amount` is only the
// regular prize-pool contribution, so the true buy-in also includes the
// starting bounty share.
function totalBuyIn(t: TournamentRow): number {
  return t.buy_in_amount + (t.is_pko ? (t.bounty_start_amount ?? 0) : 0);
}

// Compact, friendly relative day label from a yyyy-mm-dd calendar date.
function relativeDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "Last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "Last year" : `${years} years ago`;
}

// Two-letter initials for the winner avatar chip.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function byDateDesc(a: TournamentRow, b: TournamentRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1;
}

export default function FeedPage() {
  const { data, isLoading } = useSWR<TournamentRow[]>(apiKeys.tournaments);
  const items = data ?? [];
  const loading = isLoading && !data;

  const active = useMemo(
    () => items.filter(t => t.state === "Active").sort(byDateDesc),
    [items],
  );
  const finished = useMemo(
    () => items.filter(t => t.state !== "Active").sort(byDateDesc),
    [items],
  );

  // Client-side pagination over the finished feed. Reveal in PAGE_SIZE chunks.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const totalFinished = finished.length;
  // Clamp back down if the dataset shrinks (e.g. a tournament is deleted).
  useEffect(() => {
    setVisibleCount(c => Math.min(Math.max(c, PAGE_SIZE), Math.max(totalFinished, PAGE_SIZE)));
  }, [totalFinished]);
  const visibleFinished = useMemo(
    () => finished.slice(0, visibleCount),
    [finished, visibleCount],
  );
  const shownCount = Math.min(visibleCount, totalFinished);
  const hasMore = visibleCount < totalFinished;

  return (
    // overflow-x-clip guards against any transient transform (e.g. a card's
    // mount animation) briefly extending past the viewport and making the
    // page horizontally scrollable on mobile.
    <div className="space-y-6 overflow-x-clip">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feed</h1>
        <p className="muted text-sm mt-0.5">The latest from the club.</p>
      </div>

      {loading ? (
        <FeedLoading />
      ) : items.length === 0 ? (
        <EmptyState
          title="No tournaments yet"
          hint="Once you start or finish a tournament, it will show up here in the feed."
        />
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <LiveDot />
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-300">
                  Live now
                </h2>
                <span className="muted text-sm">
                  {active.length} in progress
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((t, i) => (
                  <div
                    key={t.id}
                    className="animate-row-in [animation-fill-mode:backwards]"
                    style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
                  >
                    <ActiveTournamentCard t={t} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            {active.length > 0 && (
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] muted">
                Recent tournaments
              </h2>
            )}
            {finished.length === 0 ? (
              <EmptyState
                title="No finished tournaments yet"
                hint="Completed games will appear here once you wrap up a tournament."
              />
            ) : (
              <div className="space-y-3">
                {visibleFinished.map((t, i) => (
                  <div
                    key={t.id}
                    className="animate-row-in [animation-fill-mode:backwards]"
                    style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  >
                    <FeedCard t={t} />
                  </div>
                ))}
              </div>
            )}

            {totalFinished > PAGE_SIZE && (
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
        </>
      )}
    </div>
  );
}

// A pulsing green dot used to signal live/in-progress state. The outer ring
// pings outward; the global reduced-motion guard collapses the animation.
function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
    </span>
  );
}

// Small pill badge (Special / PKO) shown in a card's header.
function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" | "violet" }) {
  const toneClass = tone === "amber"
    ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
    : "border-violet-400/40 bg-violet-400/10 text-violet-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

// One labelled stat with a leading icon, used in both card variants.
function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[var(--muted)]" aria-hidden="true">{icon}</span>
      <span className="tabular-nums font-medium text-[var(--text)]">{value}</span>
      <span className="muted">{label}</span>
    </span>
  );
}

// Distinct, prominent card for an in-progress tournament. The whole card is a
// link into the live manager. Emerald gradient + ring set it apart from the
// calmer finished-tournament feed below.
function ActiveTournamentCard({ t }: { t: TournamentRow }) {
  const name = resolveName(t);
  const usingFallback = !((t.name ?? "").trim());
  return (
    <Link
      href={`/tournaments/${t.id}`}
      className="card-interactive group relative flex flex-col gap-3 overflow-hidden rounded-card border border-emerald-400/40 bg-gradient-to-br from-emerald-500/[0.16] via-[var(--card)] to-[var(--card)] p-4 sm:p-5"
    >
      {/* Top hairline in the live accent to reinforce the distinct treatment. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LiveDot />
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-emerald-300">Live</span>
            {t.special && <Badge tone="amber">★ Special</Badge>}
            {t.is_pko && <Badge tone="violet">PKO</Badge>}
          </div>
          <h3 className={`mt-1.5 line-clamp-2 text-lg font-bold tracking-tight sm:text-xl ${usingFallback ? "muted" : ""}`}>
            {name}
          </h3>
          <p className="muted text-sm">
            {t.location_name ? `${t.location_name} · ` : ""}{relativeDay(t.date)}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="mt-1 shrink-0 text-emerald-300 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <StatChip icon={<IconUsers />} label="players" value={String(t.player_count ?? 0)} />
        <StatChip icon={<IconWallet />} label="pool so far" value={eurRounded(totalPool(t))} />
        <StatChip icon={<IconCoin />} label="buy-in" value={eurRounded(totalBuyIn(t))} />
      </div>
    </Link>
  );
}

// Social-style card for a finished tournament. Headlines the winner and shows
// the key figures; the whole card links to the tournament detail page.
function FeedCard({ t }: { t: TournamentRow }) {
  const name = resolveName(t);
  const usingFallback = !((t.name ?? "").trim());
  const winner = t.winner_name ?? null;
  return (
    <Link
      href={`/tournaments/${t.id}`}
      className="card block p-4 sm:p-5 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="muted text-xs sm:text-sm">
            {t.location_name ? `${t.location_name} · ` : ""}
            <span title={t.date}>{relativeDay(t.date)}</span>
          </p>
          <h3 className={`mt-0.5 line-clamp-2 text-lg font-semibold tracking-tight sm:text-xl ${usingFallback ? "muted" : ""}`}>
            {name}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {t.special && <Badge tone="amber">★ Special</Badge>}
          {t.is_pko && <Badge tone="violet">PKO</Badge>}
        </div>
      </div>

      {winner && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-sm font-bold text-amber-300 ring-1 ring-amber-400/30"
          >
            {initials(winner)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-amber-300">
              <IconTrophy />
              Winner
            </div>
            <div className="truncate font-semibold text-[var(--text)]">{winner}</div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <StatChip icon={<IconUsers />} label="players" value={String(t.player_count ?? 0)} />
        <StatChip icon={<IconWallet />} label="prize pool" value={eurRounded(totalPool(t))} />
        <StatChip icon={<IconCoin />} label="buy-in" value={eurRounded(totalBuyIn(t))} />
      </div>
    </Link>
  );
}

// Loading placeholder: a couple of shimmer feed cards that occupy the same
// vertical rhythm as real cards so nothing jumps when data arrives.
function FeedLoading() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="w-full space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          </div>
          <Skeleton className="mt-3 h-12 w-full rounded-lg" />
          <div className="mt-3 flex gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Friendly empty state: a soft accent-tinted icon, a heading, and a hint.
function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
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
