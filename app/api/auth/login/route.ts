import { NextResponse } from "next/server";
import { checkPassword, makeCookieValue, COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = await req.json();
  if (!checkPassword(password ?? "")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await makeCookieValue(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * 60,
  });
  return res;
}
