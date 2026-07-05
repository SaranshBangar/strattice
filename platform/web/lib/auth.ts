import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./auth-schema";
import { dash } from "@better-auth/infra";
import { getUserContact } from "./queries";
import { sendSignUpEmail, sendSignInEmail } from "./email";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true },
  // Notification emails. Both hooks fire on sign-up (user + session created); the
  // sign-in mail is skipped for accounts younger than 60s so new users get only the welcome.
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
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
