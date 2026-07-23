"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { Player } from "@/lib/types";
import { apiKeys } from "@/lib/api";
import PlayerCombobox from "@/components/PlayerCombobox";
import { IncludeSpecialToggle, SpecialTournamentBadge, NetCell } from "@/components/ui";
import { useSortable, SortableTh, type SortDir } from "@/components/sortable";
import { eur, eurSigned as fmtEur, ordinal } from "@/lib/format";

type SideStats = {
  wins: number;
  itm_count: number;
  best_finish: number | null;
  avg_finish: number | null;
  total_buy_ins: number;
  total_cost: number;
  total_winnings: number;
  net_profit: number;
  h2h_wins: number;
};

type SidePerTournament = {
  finish_position: number | null;
  buy_ins: number;
  payout: number;
  cost: number;
  net: number;
};

type HistoryRow = {
  tournament_id: string;
  date: string;
  display_name: string;
  location_name: string | null;
  special: boolean;
  a: SidePerTournament;
  b: SidePerTournament;
};

type FaceOff = {
  playerA: Player | null;
  playerB: Player | null;
  shared_count: number;
  statsA: SideStats;
  statsB: SideStats;
  history: HistoryRow[];
};

export default function FaceOffPage() {
  // Mirror the rest of the app's "Include special tournaments" toggle so the
  // user can flip themed events in or out of the comparison. Default on to
  // match the dashboard.
  const [includeSpecial, setIncludeSpecial] = useState(true);
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");

  // Roster used by both pickers. Loaded once, reused on both sides.
  const { data: players } = useSWR<Player[]>(apiKeys.players);

  // Only hit the comparison endpoint once BOTH players are picked. Empty
  // ids would just bounce off the API with a zeroed payload, but skipping
  // the request entirely also avoids a needless network round-trip.
  const shouldFetch = !!aId && !!bId && aId !== bId;
  const { data, isLoading } = useSWR<FaceOff>(
    shouldFetch ? apiKeys.faceOff(aId, bId, includeSpecial) : null,
  );

  const playerA = useMemo(() => players?.find(p => p.id === aId) ?? null, [players, aId]);
  const playerB = useMemo(() => players?.find(p => p.id === bId) ?? null, [players, bId]);

  // Roster filtered per-side so the user can't pick the same player twice.
  const playersForA = useMemo(
    () => (players ?? []).filter(p => p.id !== bId),
    [players, bId],
  );
  const playersForB = useMemo(
    () => (players ?? []).filter(p => p.id !== aId),
    [players, aId],
  );

  return (
    <div className="space-y-6">
      {/* Header row: title on the left, special-toggle on the right.
          Wraps on narrow viewports so the title stays prominent. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Face Off</h1>
        <IncludeSpecialToggle checked={includeSpecial} onChange={setIncludeSpecial} />
      </div>

      {/* Player pickers. Stack on mobile, side-by-side on `sm:` up so the
          two sides of the comparison are visually parallel from the very
          first interaction. */}
      <div className="card grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 items-end">
        <div className="min-w-0">
          <label className="label">Player A</label>
          <PlayerCombobox
            players={playersForA}
            onSelect={id => setAId(id)}
            placeholder={playerA ? playerA.name : "Search players…"}
          />
        </div>
        {/* "vs" divider — purely decorative, hidden when the layout
            collapses to a single column on mobile. */}
        <div className="hidden sm:flex items-center justify-center pb-2">
          <span className="muted text-sm font-semibold tracking-widest uppercase">vs</span>
        </div>
        <div className="min-w-0">
          <label className="label">Player B</label>
          <PlayerCombobox
            players={playersForB}
            onSelect={id => setBId(id)}
            placeholder={playerB ? playerB.name : "Search players…"}
          />
        </div>
      </div>

      {/* Three render states:
          1. Nothing picked yet → instructional empty state.
          2. Both picked, fetching → muted spinner copy.
          3. Both picked, loaded → the actual comparison + history. */}
      {!shouldFetch ? (
        <div className="card muted text-sm">
          Pick two players above to compare their head-to-head record.
        </div>
      ) : isLoading || !data ? (
        <div className="muted">Loading…</div>
      ) : (
        <FaceOffResults data={data} />
      )}
    </div>
  );
}

function FaceOffResults({ data }: { data: FaceOff }) {
  const { playerA, playerB, shared_count, statsA, statsB, history } = data;
  if (!playerA || !playerB) {
    return <div className="card muted text-sm">Pick two players to see the comparison.</div>;
  }
  if (shared_count === 0) {
    return (
      <div className="card muted text-sm">
        {playerA.name} and {playerB.name} haven&apos;t played in any of the same
        tournaments yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shared-count banner. Uses the same gradient tile look as the
          dashboard's KPI tiles so the page has a clear visual anchor. */}
      <div className="card flex items-center justify-center">
        <div className="text-center">
          <div className="text-[0.7rem] sm:text-xs uppercase tracking-[0.08em] font-semibold muted">
            Tournaments together
          </div>
          <div className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">
            {shared_count}
          </div>
        </div>
      </div>

      <ComparisonCard
        playerA={playerA} statsA={statsA}
        playerB={playerB} statsB={statsB}
      />

      <SharedHistoryTable
        playerA={playerA} playerB={playerB}
        history={history}
      />
    </div>
  );
}

/**
 * The headline comparison: two columns (one per player) with a stack of
 * metric rows in between, each row highlighting the leading side. Layout
 * stays two-column on every viewport because the parallel structure is
 * the whole point — stacking would lose the comparison.
 */
function ComparisonCard({
  playerA, statsA, playerB, statsB,
}: {
  playerA: Player;
  statsA: SideStats;
  playerB: Player;
  statsB: SideStats;
}) {
  // Lower-is-better metrics: best finish (1st > 2nd), total buy-ins (more
  // rebuys means you busted more often), and total cost. Defined inline
  // per row so the rule lives next to the metric it applies to.
  const rows: Array<{
    label: string;
    a: number | null;
    b: number | null;
    fmt: (n: number) => string;
    lowerIsBetter?: boolean;
  }> = [
    { label: "Wins (1st)",   a: statsA.wins,            b: statsB.wins,            fmt: n => String(n) },
    { label: "ITM",          a: statsA.itm_count,       b: statsB.itm_count,       fmt: n => String(n) },
    { label: "Buy-ins",      a: statsA.total_buy_ins,   b: statsB.total_buy_ins,   fmt: n => String(n), lowerIsBetter: true },
    { label: "Total cost",   a: statsA.total_cost,      b: statsB.total_cost,      fmt: eur, lowerIsBetter: true },
    { label: "Winnings",     a: statsA.total_winnings,  b: statsB.total_winnings,  fmt: eur },
    { label: "Net profit",   a: statsA.net_profit,      b: statsB.net_profit,      fmt: fmtEur },
  ];

  return (
    <div className="card overflow-hidden p-0">
      {/* SINGLE grid for the entire card (header band + metric rows) so
          all three columns share one set of widths. Per-row grids would
          let the middle "auto" column drift between rows whenever label
          widths differed (e.g. "Buy-ins" vs "Net profit"), shifting the
          centerline of the side values from row to row.

          Default `align-items: stretch` is critical: it makes every cell
          in a row span the full row height, which means `border-t` on
          each cell is drawn at the same y. With `align-items: center`,
          cells size to content and the borders would jog up/down
          between columns (the bug the screenshot showed). Each cell
          uses inner `flex items-center justify-center` to keep the
          content vertically centered within the stretched cell. */}
      <div className="grid grid-cols-[1fr_auto_1fr]">
        {/* Header band — player names with the gradient tile look, "vs"
            in the middle column. Bottom border separates the header
            from the metric rows below. */}
        <div className="flex items-center justify-center bg-gradient-to-b from-[#1a224a] to-[#0e1430] px-3 sm:px-5 py-3 sm:py-4 text-center border-b" style={{ borderColor: "var(--border)" }}>
          <Link href={`/players/${playerA.id}`} className="link text-base sm:text-lg font-bold break-words">
            {playerA.name}
          </Link>
        </div>
        <div className="flex items-center justify-center px-2 muted text-xs sm:text-sm font-semibold tracking-widest uppercase border-b" style={{ borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", borderBottomColor: "var(--border)" }}>
          vs
        </div>
        <div className="flex items-center justify-center bg-gradient-to-b from-[#1a224a] to-[#0e1430] px-3 sm:px-5 py-3 sm:py-4 text-center border-b" style={{ borderColor: "var(--border)" }}>
          <Link href={`/players/${playerB.id}`} className="link text-base sm:text-lg font-bold break-words">
            {playerB.name}
          </Link>
        </div>

        {/* Metric rows. Each row contributes three grid cells. Row
            separators are drawn with `border-t` on each cell except the
            first row (which sits directly under the header band's
            bottom border). */}
        {rows.map((r, i) => {
          const winner = pickWinner(r.a, r.b, r.lowerIsBetter ?? false);
          const rowBorder = i === 0 ? "" : "border-t";
          const borderStyle = i === 0 ? undefined : { borderColor: "var(--border)" };
          return (
            <Fragment key={r.label}>
              <div className={`flex items-center justify-center ${rowBorder}`} style={borderStyle}>
                <SideValue value={r.a} fmt={r.fmt} highlight={winner === "a"} muted={winner === "b"} />
              </div>
              <div
                className={`flex items-center justify-center px-2 py-2 sm:py-3 muted text-[0.7rem] sm:text-sm font-semibold uppercase tracking-wide text-center whitespace-nowrap ${rowBorder}`}
                style={borderStyle}
              >
                {r.label}
              </div>
              <div className={`flex items-center justify-center ${rowBorder}`} style={borderStyle}>
                <SideValue value={r.b} fmt={r.fmt} highlight={winner === "b"} muted={winner === "a"} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function pickWinner(a: number | null, b: number | null, lowerIsBetter: boolean): "a" | "b" | "tie" {
  // Treat null as "no data" — it never wins or loses; the row just won't
  // highlight a side.
  if (a == null && b == null) return "tie";
  if (a == null) return "b";
  if (b == null) return "a";
  if (a === b) return "tie";
  if (lowerIsBetter) return a < b ? "a" : "b";
  return a > b ? "a" : "b";
}

function SideValue({
  value, fmt, highlight, muted,
}: {
  value: number | null;
  fmt: (n: number) => string;
  highlight: boolean;
  muted: boolean;
}) {
  const text = value == null ? "—" : fmt(value);
  return (
    <div
      className={[
        "px-3 sm:px-5 py-2 sm:py-3 text-center text-lg sm:text-xl font-bold tabular-nums break-words",
        highlight ? "pos" : muted ? "muted" : "",
      ].join(" ")}
    >
      {text}
    </div>
  );
}

function SharedHistoryTable({
  playerA, playerB, history,
}: {
  playerA: Player;
  playerB: Player;
  history: HistoryRow[];
}) {
  // Sortable; defaults to date descending (newest first), matching the API.
  const { sorted, sortKey, sortDir, onSort } = useSortable<HistoryRow>(
    history,
    (t, key) => {
      switch (key) {
        case "tournament": return t.display_name.toLowerCase();
        case "location": return t.location_name ? t.location_name.toLowerCase() : null;
        case "aFinish": return t.a.finish_position;
        case "aNet": return t.a.net;
        case "bFinish": return t.b.finish_position;
        case "bNet": return t.b.net;
        default: return t.date;
      }
    },
    {
      initialKey: "date",
      defaultDirs: {
        date: "desc", tournament: "asc", location: "asc",
        aFinish: "asc", aNet: "desc", bFinish: "asc", bNet: "desc",
      } as Record<string, SortDir>,
    },
  );
  return (
    <div className="card overflow-x-auto">
      <h2 className="text-lg font-semibold mb-2">Tournaments together</h2>
      <table className="table whitespace-nowrap">
        <thead>
          <tr>
            <SortableTh k="date" label="Date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="tournament" label="Tournament" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="location" label="Location" className="hidden sm:table-cell" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="aFinish" label={`${playerA.name} finish`} align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="aNet" label={`${playerA.name} net`} align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="bFinish" label={`${playerB.name} finish`} align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh k="bNet" label={`${playerB.name} net`} align="center" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <th className="text-center">Winner</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(t => {
            const winner = compareFinish(t.a.finish_position, t.b.finish_position);
            return (
              <tr key={t.tournament_id}>
                <td>{t.date}</td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <Link href={`/tournaments/${t.tournament_id}`} className="link">
                      {t.display_name}
                    </Link>
                    {t.special && <SpecialTournamentBadge />}
                  </span>
                </td>
                <td className={`hidden sm:table-cell ${t.location_name ? "" : "muted"}`}>
                  {t.location_name ?? "—"}
                </td>
                <td className={`text-center ${winner === "a" ? "pos font-semibold" : ""}`}>
                  {t.a.finish_position == null ? <span className="muted">—</span> : ordinal(t.a.finish_position)}
                </td>
                <NetCell net={t.a.net} />
                <td className={`text-center ${winner === "b" ? "pos font-semibold" : ""}`}>
                  {t.b.finish_position == null ? <span className="muted">—</span> : ordinal(t.b.finish_position)}
                </td>
                <NetCell net={t.b.net} />
                <td className="text-center muted text-xs">
                  {winner === "a" ? playerA.name : winner === "b" ? playerB.name : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function compareFinish(a: number | null, b: number | null): "a" | "b" | "tie" {
  // A recorded finish always beats no recorded finish — if one player
  // placed and the other didn't, the placed player is the winner for
  // that tournament. Only "neither finished" is a true tie.
  if (a == null && b == null) return "tie";
  if (a == null) return "b";
  if (b == null) return "a";
  if (a < b) return "a";
  if (b < a) return "b";
  return "tie";
}
