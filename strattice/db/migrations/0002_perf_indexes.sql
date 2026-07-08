-- 0002_perf_indexes: indexes for query paths that were doing full table scans.
-- Idempotent; safe to re-run.
--
-- Apply (from repo root):
--   wrangler d1 execute coindcx --file strattice/db/migrations/0002_perf_indexes.sql --remote

-- subscriptions is looked up by cashfree_sub_id on every webhook delivery and cancel
-- action (lib/queries.ts userIdByCashfreeSub / setSubscriptionStatus), but only has a
-- PK on user_id. NULL-safe: SQLite treats each NULL as distinct in a unique index, so
-- users without a subscription (cashfree_sub_id IS NULL) never collide.
create unique index if not exists subscriptions_cashfree_sub on subscriptions(cashfree_sub_id);

-- Better Auth's own FK columns had no explicit index.
create index if not exists account_user on account(userId);
create index if not exists session_user on session(userId);

-- listStrategies() orders by position within a user; a composite index serves both
-- the user_id filter and the order-by, making the old single-column index redundant.
drop index if exists user_strategies_user;
create index if not exists user_strategies_user_position on user_strategies(user_id, position);
