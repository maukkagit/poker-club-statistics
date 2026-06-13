// Server-side push for the public tournament clock viewer.
//
// After any live mutation we fire a Supabase Realtime *broadcast* on the
// tournament's `clock:{token}` channel. Browsers viewing the read-only clock
// subscribe to that channel and refetch immediately, so a pause/resume/bust on
// the director's screen reaches remote projectors in well under a second.
//
// This uses Realtime's stateless HTTP broadcast endpoint (no persistent
// websocket from the server, which suits serverless route handlers). It is
// strictly best-effort: every viewer also polls on an interval, so a failed or
// unconfigured broadcast only costs a little extra latency, never correctness.
import { supabase } from "@/lib/supabase";
import { clockChannel, CLOCK_EVENT } from "@/lib/clock-channel";

/**
 * Broadcast a "changed" ping to the viewer channel for the tournament `id`.
 * Looks up the share token (the public channel handle) first. Never throws.
 */
export async function broadcastTournamentChanged(id: string): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const { data } = await supabase()
      .from("tournaments").select("share_token").eq("id", id).maybeSingle();
    const token = data?.share_token as string | undefined;
    if (!token) return;

    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: clockChannel(token), event: CLOCK_EVENT, payload: {} }],
      }),
    });
  } catch {
    // Best-effort: viewers fall back to polling.
  }
}
