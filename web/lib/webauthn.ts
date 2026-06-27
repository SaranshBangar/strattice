import { promises as fs } from "fs";
import path from "path";

// One device-bound credential per registration. The biometric (platform
// authenticator) proves possession of the device; verifying its signature
// server-side authorizes setting the existing `auth` cookie. The passphrase
// itself never travels through this flow. ponytail: flat JSON file, single
// user — swap for the bot.db SQLite only if we ever need multi-user.

export type StoredCredential = {
  id: string; // base64url credential id
  publicKey: string; // base64url COSE public key
  counter: number;
  transports?: string[];
};

const FILE =
  process.env.WEBAUTHN_STORE ||
  path.join(process.cwd(), "data", "webauthn.json");

export async function loadCredentials(): Promise<StoredCredential[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return []; // missing file == no devices enrolled yet
  }
}

export async function saveCredentials(creds: StoredCredential[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(creds, null, 2));
}

// Derive Relying Party id/origin from the request. Behind the Cloudflare
// tunnel the public host arrives in x-forwarded-* headers, not req.url.
export function rp(req: Request) {
  const host =
    process.env.RP_ID_HOST ||
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "localhost";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return {
    rpName: "Bot Dashboard",
    rpID: host.split(":")[0],
    origin: process.env.RP_ORIGIN || `${proto}://${host}`,
  };
}

// Single fixed user — the dashboard has exactly one human.
export const USER_ID = new TextEncoder().encode("dashboard");
export const USER_NAME = "dashboard";

const CHALLENGE_COOKIE = "wa_chal";

// Read a cookie from the raw request header — route handlers don't expose
// a parsed cookie jar on the plain Request.
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") || "";
  const hit = header.split(";").find((c) => c.trim().startsWith(name + "="));
  return hit
    ? decodeURIComponent(hit.split("=").slice(1).join("=").trim())
    : undefined;
}

export function challengeCookie(value: string) {
  return {
    name: CHALLENGE_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 300, // challenge is single-use, short-lived
  };
}
export { CHALLENGE_COOKIE };
