import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth";
import { isAdmin } from "./admin";

export const getUser = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
});

export async function requireUserId(): Promise<string> {
  const u = await getUser();
  if (!u) throw new Error("unauthorized");
  return u.id;
}

/** Server-side admin gate. Every admin action must call this - never trust the client. */
export async function requireAdmin() {
  const u = await getUser();
  if (!u || !isAdmin(u.email)) throw new Error("forbidden");
  return u;
}
