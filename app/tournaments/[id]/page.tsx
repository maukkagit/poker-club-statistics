"use client";
import { useMemo } from "react";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import TournamentEditor, { type EntryDraft, type TournamentDraft } from "@/components/TournamentEditor";
import { apiKeys, invalidateAfterTournamentMutation, ApiError } from "@/lib/api";

type TournamentDetail = {
  tournament: {
    id: string;
    date: string;
    name: string;
    buy_in_amount: number;
    payout_structure: TournamentDraft["payout_structure"];
    notes?: string | null;
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit tournament</h1>
      <TournamentEditor
        // `key` forces a fresh editor when the cached payload changes
        // identity (e.g. after a save round-trip), so internal drafts
        // resync with the server response.
        key={data?.tournament.id ?? id}
        mode="edit"
        initialTournament={draft.t}
        initialEntries={draft.entries}
        onSubmit={async (td, es) => {
          const res = await fetch(`/api/tournaments/${id}`, { method: "PUT", body: JSON.stringify({ tournament: td, entries: es }) });
          if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
          await invalidateAfterTournamentMutation(id);
          router.push("/tournaments");
        }}
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
