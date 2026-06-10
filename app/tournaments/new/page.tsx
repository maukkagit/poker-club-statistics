"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TournamentEditor, { type EntryDraft, type TournamentDraft } from "@/components/TournamentEditor";
import StartTournamentWizard from "@/components/StartTournamentWizard";
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

  // "Start a tournament" → the guided seat-draw wizard (issue #20). The
  // "Add a finished tournament" path keeps the single-form editor unchanged.
  if (state === "Active") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Start a tournament</h1>
        <StartTournamentWizard onCancel={() => router.push("/tournaments")} />
      </div>
    );
  }

  // "Add a finished tournament" path: post the full form data exactly like
  // before and return to the list. (The Active "start now" path is handled by
  // the wizard above and never reaches here.)
  async function postFinished(t: TournamentDraft, entries: EntryDraft[]) {
    const res = await fetch("/api/tournaments", {
      method: "POST",
      body: JSON.stringify({ ...t, entries, state: "Finished" }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
    const created = await res.json();
    await invalidateAfterTournamentMutation(created.id);
    router.push("/tournaments");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Add a finished tournament</h1>
      <TournamentEditor
        mode="create"
        state="Finished"
        onSubmit={postFinished}
        onCancel={() => router.push("/tournaments")}
      />
    </div>
  );
}
