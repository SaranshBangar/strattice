import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Single-passphrase gate. Everything requires the `auth` cookie except the
// login page/route and PWA static files. ponytail: cookie value == passphrase
// hash check happens in /api/login; here we only check presence + match.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/webauthn/auth") || // fingerprint unlock (pre-login)
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons");
  if (open) return NextResponse.next();

  const cookie = req.cookies.get("auth")?.value;
  if (cookie && cookie === process.env.APP_PASSPHRASE) return NextResponse.next();

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // skip Next internals + static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
