-- 0003_strategy_weight: per-strategy capital split. Lets a user run several strategies
-- with an uneven allocation instead of the implicit equal split. Defaults every
-- existing row to 1.0 - equal weight - so nothing changes until a user opts in.
-- NOT idempotent (SQLite has no "add column if not exists"); only run once.
--
-- Apply (from repo root):
--   wrangler d1 execute coindcx --file strattice/db/migrations/0003_strategy_weight.sql --remote

alter table user_strategies add column weight real not null default 1.0;
