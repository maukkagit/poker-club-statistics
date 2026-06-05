"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import TournamentEditor, { type EntryDraft, type TournamentDraft } from "@/components/TournamentEditor";

export default function EditTournamentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [t, setT] = useState<TournamentDraft | null>(null);
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tournaments/${id}`).then(async r => {
      if (!r.ok) { setErr("Tournament not found"); return; }
      const d = await r.json();
      setT({
        date: d.tournament.date, name: d.tournament.name,
        buy_in_amount: d.tournament.buy_in_amount,
        payout_structure: d.tournament.payout_structure,
        notes: d.tournament.notes ?? "",
      });
      setEntries(d.entries.map((e: any) => ({
        id: e.id, player_id: e.player_id, buy_ins: e.buy_ins,
        finish_position: e.finish_position, payout_override: e.payout_override,
      })));
    });
  }, [id]);

  if (err) return <div className="card neg">{err}</div>;
  if (!t) return <div className="muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit tournament</h1>
      <TournamentEditor
        mode="edit"
        initialTournament={t}
        initialEntries={entries}
        onSubmit={async (td, es) => {
          const res = await fetch(`/api/tournaments/${id}`, { method: "PUT", body: JSON.stringify({ tournament: td, entries: es }) });
          if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
          router.push("/tournaments");
        }}
        onDelete={async () => {
          const res = await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Failed to delete");
          router.push("/tournaments");
        }}
      />
    </div>
  );
}
