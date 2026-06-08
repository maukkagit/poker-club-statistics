"use client";
import { useMemo } from "react";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import TournamentEditor, { type EntryDraft, type TournamentDraft } from "@/components/TournamentEditor";
import type { TournamentState } from "@/lib/types";
import { apiKeys, invalidateAfterTournamentMutation, ApiError } from "@/lib/api";

type TournamentDetail = {
  tournament: {
    id: string;
    date: string;
    name: string;
    buy_in_amount: number;
    payout_structure: TournamentDraft["payout_structure"];
    notes?: string | null;
    location_id?: string | null;
    state: TournamentState;
    special?: boolean;
    // Pre-resolved by the API for the "Tournament #N" fallback when the
    // user-supplied name is blank.
    order_number?: number | null;
    display_name?: string;
  };
  entries: Array<{
    id: string;
    player_id: string;
    buy_ins: number;
    finish_position: number | null;
    payout_override: number | null;
  }>;
};

export default function EditTournamentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, error, isLoading } = useSWR<TournamentDetail>(apiKeys.tournament(id));

  const draft = useMemo<{ t: TournamentDraft; entries: EntryDraft[] } | null>(() => {
    if (!data) return null;
    return {
      t: {
        date: data.tournament.date,
        name: data.tournament.name,
        buy_in_amount: data.tournament.buy_in_amount,
        payout_structure: data.tournament.payout_structure,
        notes: data.tournament.notes ?? "",
        location_id: data.tournament.location_id ?? null,
        special: !!data.tournament.special,
      },
      entries: data.entries.map(e => ({
        id: e.id,
        player_id: e.player_id,
        buy_ins: e.buy_ins,
        finish_position: e.finish_position,
        payout_override: e.payout_override,
      })),
    };
  }, [data]);

  if (error) {
    const msg = error instanceof ApiError && error.status === 404
      ? "Tournament not found"
      : (error as Error).message ?? "Failed to load tournament";
    return <div className="card neg">{msg}</div>;
  }
  if (isLoading || !draft) return <div className="muted">Loading…</div>;

  const state: TournamentState = data?.tournament.state ?? "Finished";
  const isSpecial = !!data?.tournament.special;

  // Heading variants:
  // - Active + named:   "Active — <name>"
  // - Active + unnamed: "Active tournament"
  // - Finished + named: "Edit tournament — <name>"
  // - Finished + unnamed: "Edit Tournament #N"
  const hasName = !!(data?.tournament.name ?? "").trim();
  const fallback = data?.tournament.display_name
    ?? (data?.tournament.order_number ? `Tournament #${data?.tournament.order_number}` : "tournament");
  const heading = state === "Active"
    ? hasName
      ? <>Active <span className="muted font-normal">— {data!.tournament.name}</span></>
      : <>Active tournament</>
    : hasName
      ? <>Edit tournament <span className="muted font-normal">— {data!.tournament.name}</span></>
      : <>Edit {fallback}</>;

  // PUT helper used by Save / Finish. Passing `state` explicitly lets us
  // transition Active → Finished from the same form by changing only one
  // field on submit; everything else flows through unchanged.
  async function put(td: TournamentDraft, es: EntryDraft[], nextState: TournamentState) {
    const res = await fetch(`/api/tournaments/${id}`, {
      method: "PUT",
      body: JSON.stringify({ tournament: { ...td, state: nextState }, entries: es }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    await invalidateAfterTournamentMutation(id);
    router.push("/tournaments");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">{heading}</h1>
        {state === "Active" && (
          // Pill badge that makes the lifecycle state obvious at the top of
          // the page. Sky-blue mirrors the Active card accent in the
          // chooser dialog so the visual story stays consistent.
          <span
            className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border"
            style={{
              color: "rgb(14 165 233)",
              borderColor: "rgb(14 165 233 / 0.4)",
              background: "rgb(14 165 233 / 0.12)",
            }}
          >
            Live
          </span>
        )}
        {isSpecial && (
          // Amber to distinguish from the sky-blue "Live" pill — special
          // tournaments are a flavour annotation, not a lifecycle state.
          <span
            className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full border"
            style={{
              color: "rgb(251 191 36)",
              borderColor: "rgb(251 191 36 / 0.4)",
              background: "rgb(251 191 36 / 0.12)",
            }}
          >
            Special
          </span>
        )}
      </div>
      <TournamentEditor
        // `key` forces a fresh editor when the cached payload changes
        // identity (e.g. after a save round-trip), so internal drafts
        // resync with the server response.
        key={data?.tournament.id ?? id}
        mode="edit"
        state={state}
        initialTournament={draft.t}
        initialEntries={draft.entries}
        // Save keeps state as-is. For an active tournament that's still
        // Active; for a finished one that's still Finished.
        onSubmit={(td, es) => put(td, es, state)}
        // onFinish is only meaningful when the tournament is currently
        // Active. The button shows up exclusively in that case and flips
        // the state to Finished server-side.
        onFinish={state === "Active" ? (td, es) => put(td, es, "Finished") : undefined}
        onDelete={async () => {
          const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Failed to delete");
          await invalidateAfterTournamentMutation(id);
          router.push("/tournaments");
        }}
        onCancel={() => router.push("/tournaments")}
      />
    </div>
  );
}
