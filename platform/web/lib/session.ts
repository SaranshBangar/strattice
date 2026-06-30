import { headers } from "next/headers";
import { auth } from "./auth";

export async function getUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}

export async function requireUserId(): Promise<string> {
  const u = await getUser();
  if (!u) throw new Error("unauthorized");
  return u.id;
}
