"use client";
import { createAuthClient } from "better-auth/react";
import { sentinelClient } from "@better-auth/infra/client";

export const authClient = createAuthClient({
  plugins: [sentinelClient()],
});
export const { signIn, signUp, signOut, useSession } = authClient;
