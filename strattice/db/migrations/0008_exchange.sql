-- 0008_exchange: which exchange a user's linked API keys belong to (coindcx | binance).
-- The supervisor generates the user's engine config for that venue (quote currency,
-- friction model, client) and the web app shows exchange-specific copy/markets.
-- Every pre-existing credential row is a CoinDCX key, hence the default. NOT idempotent
-- (SQLite has no "add column if not exists"); both runtimes self-heal the column on
-- first miss (web/lib/queries.ts, worker/store.py), so applying it by hand is optional
-- but keeps deployed D1 in sync.
--
-- Apply (from repo root):
--   wrangler d1 execute strattice --file strattice/db/migrations/0008_exchange.sql --remote

alter table exchange_credentials add column exchange text not null default 'coindcx';
