"use client";
import { useRouter } from "next/navigation";
import TournamentEditor from "@/components/TournamentEditor";
import { invalidateAfterTournamentMutation } from "@/lib/api";

export default function NewTournamentPage() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">New tournament</h1>
      <TournamentEditor
        mode="create"
        onSubmit={async (t, entries) => {
          const res = await fetch("/api/tournaments", { method: "POST", body: JSON.stringify({ ...t, entries }) });
          if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
          const created = await res.json();
          await invalidateAfterTournamentMutation(created.id);
          router.push(`/tournaments/${created.id}`);
        }}
        onCancel={() => router.push("/tournaments")}
      />
    </div>
  );
}
