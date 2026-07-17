-- 0006_stat_window: per-user dashboard stat-card trend timeline (1h|6h|1d|1w|1m|all),
-- defaulting to 1 day. Controls only the top stat cards' trend sparklines (and the pro-view
-- charts that share the same series); the headline numbers are unaffected. Defaults every
-- existing row to '1d'. NOT idempotent (SQLite has no "add column if not exists"); the app
-- also self-heals this column on first miss (web/lib/queries.ts), so applying it by hand is
-- optional but keeps deployed D1 in sync.
--
-- Apply (from repo root):
--   wrangler d1 execute strattice --file strattice/db/migrations/0006_stat_window.sql --remote

alter table notification_prefs add column stat_window text not null default '1d';
