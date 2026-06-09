"use client";
import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    const res = await fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: pw }) });
    setLoading(false);
    if (res.ok) {
      const params = new URLSearchParams(location.search);
      location.href = params.get("next") || "/";
    } else setErr("Wrong password");
  }
  return (
    <div className="max-w-sm mx-auto mt-20 card">
      <h1 className="text-2xl font-bold mb-4">♠ Poker Club</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        </div>
        {err && <div className="neg text-sm">{err}</div>}
        <button className="btn w-full justify-center" disabled={loading || !pw}>Sign in</button>
      </form>
    </div>
  );
}
