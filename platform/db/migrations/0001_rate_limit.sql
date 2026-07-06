-- 0001_rate_limit: persistent store for Better Auth's DB-backed rate limiter.
-- Memory storage is per-serverless-instance and useless on Vercel, so counters live in D1.
-- Idempotent; safe to re-run. lastRequest is epoch milliseconds.
--
-- Apply (from repo root):
--   wrangler d1 execute coindcx --file platform/db/migrations/0001_rate_limit.sql --remote
create table if not exists rateLimit (
  id          text primary key,
  key         text unique,
  count       integer,
  lastRequest integer
);
