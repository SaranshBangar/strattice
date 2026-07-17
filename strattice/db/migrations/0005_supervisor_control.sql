-- 0005_supervisor_control: control + status channel for the Python supervisor, so the admin
-- console can start/stop/restart it and show whether it's up. Singleton row (id='singleton'):
-- the app writes desired_state (running|paused) and bumps restart_seq to request a restart;
-- the supervisor reads it each poll and writes back state/engines/last_heartbeat/last_error.
-- "create table if not exists" makes this idempotent and byte-identical to schema.sql; the
-- app (web/lib/queries.ts) and supervisor (worker/store.py) also self-heal this table on first
-- miss, so applying this migration by hand is optional but keeps deployed D1 in sync.
--
-- Apply (from repo root):
--   wrangler d1 execute strattice --file strattice/db/migrations/0005_supervisor_control.sql --remote

create table if not exists supervisor_control (
  id                  text primary key default 'singleton',
  desired_state       text not null default 'running',
  restart_seq         integer not null default 0,
  state               text,
  engines             integer,
  applied_restart_seq integer not null default 0,
  last_heartbeat      integer,
  last_error          text,
  updated_at          text not null default (datetime('now'))
);
