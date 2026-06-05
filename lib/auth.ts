// Web-Crypto based auth so it works in both Edge (middleware) and Node (API routes).
import { cookies } from "next/headers";

const COOKIE = "pc_session";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-only-secret-change-me";
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return toHex(sig);
}

export async function makeCookieValue(): Promise<string> {
  const v = String(Date.now());
  return `${v}.${await hmac(v)}`;
}

export async function verifyCookieValue(v: string | undefined): Promise<boolean> {
  if (!v) return false;
  const [val, sig] = v.split(".");
  if (!val || !sig) return false;
  const expected = await hmac(val);
  if (expected.length !== sig.length) return false;
  // constant-time string compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function isAuthed(): Promise<boolean> {
  const c = cookies().get(COOKIE)?.value;
  return verifyCookieValue(c);
}

export function checkPassword(pw: string): boolean {
  const want = process.env.APP_PASSWORD;
  if (!want) return false;
  if (pw.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < pw.length; i++) diff |= pw.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export const COOKIE_NAME = COOKIE;
