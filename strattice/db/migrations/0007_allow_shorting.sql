-- 0007_allow_shorting: per-user opt-in permission for short-capable strategy templates
-- (donchian_ls / ensemble_ls). Default OFF for every user: shorting is an explicit,
-- separate consent in Settings, and the server refuses to add a short-capable strategy
-- without it. Note the live spot engine executes the LONG side only (SHORT/COVER
-- signals are inert by construction) - the flag gates configuration, mandatory SL/TP
-- enforcement and paper/research behavior, not real short orders. NOT idempotent
-- (SQLite has no "add column if not exists"); the app also self-heals this column on
-- first miss (web/lib/queries.ts), so applying it by hand is optional but keeps
-- deployed D1 in sync.
--
-- Apply (from repo root):
--   wrangler d1 execute strattice --file strattice/db/migrations/0007_allow_shorting.sql --remote

alter table notification_prefs add column allow_shorting integer not null default 0;
