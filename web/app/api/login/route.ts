import { NextResponse } from "next/server";
import { APP_PASSPHRASE } from "@/lib/auth";

// Set an httpOnly cookie equal to the passphrase when it matches. Single user,
// no DB. ponytail: shared-secret gate; upgrade to NextAuth only if multi-user.
export async function POST(req: Request) {
  const { passphrase } = await req.json().catch(() => ({ passphrase: "" }));
  if (!passphrase || passphrase !== APP_PASSPHRASE) {
    return NextResponse.json({ error: "wrong passphrase" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("auth", passphrase, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
