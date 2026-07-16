-- 0004_unrealized_pnl: mark-to-market P&L on open positions, published alongside the
-- cash-basis book equity so the dashboard can show both without a live-price round trip
-- on read. Defaults every existing row to 0 - backfilled naturally by the next publish.
-- NOT idempotent (SQLite has no "add column if not exists"); only run once.
--
-- Apply (from repo root):
--   wrangler d1 execute strattice --file strattice/db/migrations/0004_unrealized_pnl.sql --remote

alter table equity_snapshots add column unrealized_pnl real not null default 0;
