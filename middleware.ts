import { NextResponse, type NextRequest } from "next/server";
import { verifyCookieValue, COOKIE_NAME } from "./lib/auth";

export const config = {
  // The negative lookahead lists the paths that bypass the auth gate entirely.
  // `clock/` is the public read-only projector view and `api/public/` is its
  // data endpoint — both are reachable with only a share token, no password.
  matcher: ["/((?!_next/|favicon|login|clock/|api/auth/login|api/public/).*)"],
};

export async function middleware(req: NextRequest) {
  const c = req.cookies.get(COOKIE_NAME)?.value;
  if (await verifyCookieValue(c)) return NextResponse.next();
  const url = req.nextUrl.clone();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
