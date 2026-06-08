"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TournamentEditor, { type EntryDraft, type TournamentDraft } from "@/components/TournamentEditor";
import type { TournamentState } from "@/lib/types";
import { invalidateAfterTournamentMutation } from "@/lib/api";

/**
 * useSearchParams() forces this route into client-side rendering, which
 * means Next's build-time prerender for /tournaments/new would crash
 * unless the hook is wrapped in a <Suspense> boundary. We isolate the
 * hook-using code in NewTournamentInner and let Suspense show a tiny
 * fallback while the URL params are read on the client.
 *
 * See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
 */
export default function NewTournamentPage() {
  return (
    <Suspense fallback={<div className="muted">Loading…</div>}>
      <NewTournamentInner />
    </Suspense>
  );
}

function NewTournamentInner() {
  const router = useRouter();
  const params = useSearchParams();
  // The "+ New" modal on /tournaments forwards either ?state=Active or
  // ?state=Finished. Anything else (manual URL hit) defaults to Finished
  // because that's the historic, "add a completed game" flow.
  const stateParam = params.get("state");
  const state: TournamentState = stateParam === "Active" ? "Active" : "Finished";

  // Active tournaments POST with state="Active" and the entries collected
  // so far (each with buy_ins=1, no finish, no override). Finished ones
  // post the full form data exactly like before.
  async function postNew(t: TournamentDraft, entries: EntryDraft[], submitState: TournamentState) {
    const res = await fetch("/api/tournaments", {
      method: "POST",
      body: JSON.stringify({ ...t, entries, state: submitState }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
    const created = await res.json();
    await invalidateAfterTournamentMutation(created.id);
    // For "Start tournament" → land on the edit page so the user can
    // immediately track buy-ins as the night plays out. For "Add a
    // finished tournament" → back to the list since the row is final.
    if (submitState === "Active") {
      router.push(`/tournaments/${created.id}`);
    } else {
      router.push("/tournaments");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        {state === "Active" ? "Start a tournament" : "Add a finished tournament"}
      </h1>
      <TournamentEditor
        mode="create"
        state={state}
        onSubmit={(t, entries) => postNew(t, entries, state)}
        onCancel={() => router.push("/tournaments")}
      />
    </div>
  );
}
