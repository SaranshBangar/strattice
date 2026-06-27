import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { loadCredentials, rp, challengeCookie } from "@/lib/webauthn";

// Public: no auth cookie yet — this is how you log in by fingerprint.
export async function POST(req: Request) {
  const { rpID } = rp(req);
  const creds = await loadCredentials();
  if (creds.length === 0) {
    return NextResponse.json({ enrolled: false });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports as any,
    })),
  });

  const res = NextResponse.json({ enrolled: true, options });
  res.cookies.set(challengeCookie(options.challenge));
  return res;
}
