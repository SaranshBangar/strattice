import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  loadCredentials,
  rp,
  USER_ID,
  USER_NAME,
  challengeCookie,
} from "@/lib/webauthn";

// Gated by middleware (requires the `auth` cookie) — you must already be
// logged in with the passphrase to enroll a fingerprint.
export async function POST(req: Request) {
  const { rpName, rpID } = rp(req);
  const existing = await loadCredentials();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: USER_ID,
    userName: USER_NAME,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required", // force the biometric/PIN gesture
      authenticatorAttachment: "platform", // on-device sensor, not roaming key
    },
  });

  const res = NextResponse.json(options);
  res.cookies.set(challengeCookie(options.challenge));
  return res;
}
