import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  loadCredentials,
  saveCredentials,
  rp,
  readCookie,
  CHALLENGE_COOKIE,
} from "@/lib/webauthn";

export async function POST(req: Request) {
  const { rpID, origin } = rp(req);
  const challenge = readCookie(req, CHALLENGE_COOKIE);
  if (!challenge) {
    return NextResponse.json({ error: "no challenge" }, { status: 400 });
  }

  const body = await req.json();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "not verified" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const creds = await loadCredentials();
  creds.push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
  });
  await saveCredentials(creds);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}
