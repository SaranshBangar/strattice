// Better Auth rate-limit storage backed by D1, used via rateLimit.customStorage in lib/auth.ts.
//
// Two guarantees, both aimed at never letting the limiter break authentication:
//   1. Self-healing - if the `rateLimit` table doesn't exist yet (schema.sql / migration
//      0001 not applied), it is created on first use, so a missed migration can't lock users
//      out of sign-in/sign-up/reset/verify. Mirrors the notification_prefs self-heal in
//      queries.ts.
//   2. Fail-open - any storage error is swallowed (get returns null, set is a no-op) so a
//      rate-limit lookup can never throw into the auth request. Worst case is "no limiting",
//      never "no login".
//
// Better Auth calls get() then set() per request (the best-effort path for a storage without
// an atomic `consume`); it applies the window/count logic itself from the row we return.
import "server-only";
import { randomUUID } from "crypto";
import { d1Query, d1First } from "./d1";

const DDL = `create table if not exists rateLimit (
  id          text primary key,
  key         text unique,
  count       integer,
  lastRequest integer
)`;

// Run fn; if it fails only because the table is missing, create it once and retry.
async function withTable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (String(e).includes("no such table: rateLimit")) {
      await d1Query(DDL);
      return fn();
    }
    throw e;
  }
}

interface Row {
  key: string;
  count: number;
  lastRequest: number;
}

export const rateLimitStore = {
  async get(key: string): Promise<Row | null> {
    try {
      const row = await withTable(() =>
        d1First<{ count: number; lastRequest: number }>(
          "select count, lastRequest from rateLimit where key = ?",
          [key],
        ),
      );
      return row
        ? { key, count: Number(row.count), lastRequest: Number(row.lastRequest) }
        : null;
    } catch (e) {
      // Fail open: never block an auth request because the limiter's read failed.
      console.error("[rate-limit] get failed; allowing request:", String(e));
      return null;
    }
  },

  async set(
    key: string,
    value: { count: number; lastRequest: number },
  ): Promise<void> {
    try {
      await withTable(() =>
        d1Query(
          `insert into rateLimit(id, key, count, lastRequest) values (?,?,?,?)
           on conflict(key) do update set count=excluded.count, lastRequest=excluded.lastRequest`,
          [randomUUID(), key, value.count, value.lastRequest],
        ),
      );
    } catch (e) {
      // Fail open: a failed write just means this request isn't counted.
      console.error("[rate-limit] set failed; skipping:", String(e));
    }
  },
};
