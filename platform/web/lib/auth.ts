import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./auth-schema";
import { dash } from "@better-auth/infra";
import { getUserContact } from "./queries";
import {
  sendSignUpEmail,
  sendSignInEmail,
  sendVerifyEmail,
  sendResetEmail,
} from "./email";

// Fail closed in production: with no secret, sessions are signed with a predictable
// default and can be forged. The env is intentionally absent during `next build`
// (NEXT_PHASE marks that phase), so only enforce this at real request time.
if (
  !process.env.BETTER_AUTH_SECRET &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error(
    "BETTER_AUTH_SECRET is not set - refusing to start, as sessions would be signed with an insecure default.",
  );
}

// In dev, SMTP is usually unset so verification/reset emails are skipped. Log the link
// so local password flows remain testable without a mail server.
const devLogLink = (label: string, url: string) => {
  if (process.env.NODE_ENV !== "production")
    console.info(`[auth] ${label}: ${url}`);
};

// Optional integrations are only wired up when fully configured, so the app never ships a
// dead "Continue with Google" button or silently drops every email. Surfaced here (and to
// the sign-in page) instead of failing at first use.
export const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  const missing: string[] = [];
  if (!process.env.SMTP_HOST)
    missing.push("SMTP_HOST (all email, incl. verification/reset, is skipped)");
  if (!googleConfigured)
    missing.push("GOOGLE_CLIENT_ID/SECRET (Google sign-in hidden)");
  if (missing.length)
    console.warn(`[config] missing in production - ${missing.join("; ")}`);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  // Brute-force / abuse protection on the auth endpoints. Memory storage is per-instance
  // and useless on serverless, so persist counters in D1 (see the rateLimit table in
  // auth-schema.ts / platform/db/schema.sql). On by default in production.
  rateLimit: {
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 5 },
      "/reset-password": { window: 60, max: 10 },
      "/send-verification-email": { window: 60, max: 5 },
    },
  },
  emailAndPassword: {
    enabled: true,
    // No session until the address is confirmed - stops registration with emails the
    // user doesn't own and the email-bomb vector that opens up. Google sign-ins arrive
    // pre-verified from the provider, so they are unaffected.
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      devLogLink("reset password", url);
      await sendResetEmail(user.email, url, user.name);
    },
    resetPasswordTokenExpiresIn: 3600,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => {
      devLogLink("verify email", url);
      await sendVerifyEmail(user.email, url, user.name);
    },
  },
  // Notification emails. The welcome fires on user creation; the sign-in mail is skipped
  // for accounts younger than 60s so a fresh Google sign-up (which does create a session)
  // gets only the welcome. Password sign-ups create no session until verified, so their
  // sign-in mail naturally waits until they actually log in.
  databaseHooks: {
    user: {
      create: {
        after: async (user: { email: string; name?: string | null }) => {
          await sendSignUpEmail(user.email, user.name);
        },
      },
    },
    session: {
      create: {
        after: async (session: { userId: string }) => {
          const u = await getUserContact(session.userId);
          if (!u) return;
          const fresh =
            u.created_at != null && Date.now() / 1000 - u.created_at < 60;
          if (!fresh) await sendSignInEmail(u.email, u.name);
        },
      },
    },
  },
  // Registered only when configured, so an unconfigured deploy doesn't advertise a
  // provider that errors on use (see googleConfigured above).
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {},
  // Auto-link Google sign-ins to an existing email/password account with the
  // same email. Google verifies its emails, so this is safe as a trusted provider.
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Origins allowed to call the auth API. baseURL is prod, so local dev and the
  // www/apex variants must be whitelisted or Better Auth rejects with "invalid origin".
  trustedOrigins: [
    process.env.BETTER_AUTH_URL,
    "https://strattice.in",
    "https://www.strattice.in",
    "http://localhost:3000",
  ].filter(Boolean) as string[],
  plugins: [dash()],
});
