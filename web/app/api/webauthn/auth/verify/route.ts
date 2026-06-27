import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  loadCredentials,
  saveCredentials,
  rp,
  readCookie,
  CHALLENGE_COOKIE,
} from "@/lib/webauthn";

// Public. A verified biometric assertion authorizes the server to issue the
// same `auth` cookie that the passphrase login sets — the passphrase stays
// server-side and never round-trips through the device.
export async function POST(req: Request) {
  const { rpID, origin } = rp(req);
  const challenge = readCookie(req, CHALLENGE_COOKIE);
  if (!challenge) {
    return NextResponse.json({ error: "no challenge" }, { status: 400 });
  }

  const body = await req.json();
  const creds = await loadCredentials();
  const cred = creds.find((c) => c.id === body.id);
  if (!cred) {
    return NextResponse.json({ error: "unknown credential" }, { status: 401 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: cred.transports as any,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 401 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "not verified" }, { status: 401 });
  }

  // Persist the signature counter to catch cloned authenticators.
  cred.counter = verification.authenticationInfo.newCounter;
  await saveCredentials(creds);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("auth", process.env.APP_PASSPHRASE!, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // mirror the passphrase login
  });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}
