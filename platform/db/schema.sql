-- Platform schema for Cloudflare D1 (SQLite dialect). Integration boundary between the
-- Next.js app (writes desired state) and the Python supervisor (reads it, writes observed
-- state). Apply with: wrangler d1 execute <DB> --file platform/db/schema.sql --remote
--
-- IDs are app-generated UUIDs (crypto.randomUUID() in Node, uuid4 in Python) — SQLite has no
-- gen_random_uuid(). Booleans are INTEGER 0/1. Timestamps: Better Auth manages its own; our
-- tables use INTEGER unix-seconds where the supervisor compares time, else TEXT ISO.

-- ───────────── Better Auth core tables ─────────────
-- Mirrors Better Auth's default SQLite schema. Authoritative source is the CLI:
--   npx @better-auth/cli generate     (run after configuring auth; reconcile if it differs)
create table if not exists user (
  id            text primary key,
  name          text,
  email         text unique not null,
  emailVerified integer not null default 0,
  image         text,
  createdAt     integer not null,
  updatedAt     integer not null
);
create table if not exists session (
  id        text primary key,
  userId    text not null references user(id) on delete cascade,
  token     text unique not null,
  expiresAt integer not null,
  ipAddress text,
  userAgent text,
  createdAt integer not null,
  updatedAt integer not null
);
create table if not exists account (
  id                    text primary key,
  userId                text not null references user(id) on delete cascade,
  accountId             text not null,
  providerId            text not null,
  accessToken           text,
  refreshToken          text,
  idToken               text,
  accessTokenExpiresAt  integer,
  refreshTokenExpiresAt integer,
  scope                 text,
  password              text,
  createdAt             integer not null,
  updatedAt             integer not null
);
create table if not exists verification (
  id         text primary key,
  identifier text not null,
  value      text not null,
  expiresAt  integer not null,
  createdAt  integer,
  updatedAt  integer
);
-- Persistent rate-limit counters for Better Auth (rateLimit.storage = "database").
-- Per-instance memory storage is useless on serverless, so the limiter lives here.
-- lastRequest is epoch milliseconds.
create table if not exists rateLimit (
  id          text primary key,
  key         text unique,
  count       integer,
  lastRequest integer
);

-- ───────────── App tables (FK -> Better Auth user) ─────────────

-- CoinDCX API keys, encrypted at rest (AES-256-GCM, worker/crypto.py == web/lib/crypto.ts).
create table if not exists exchange_credentials (
  user_id     text primary key references user(id) on delete cascade,
  api_key_enc text not null,
  secret_enc  text not null,
  key_label   text,
  created_at  text not null default (datetime('now'))
);

-- Effective tier = tier WHILE status='active' AND (period_end IS NULL OR period_end > now),
-- else 'free'. period_end is unix seconds. Cashfree fields populated in Phase 3.
create table if not exists subscriptions (
  user_id          text primary key references user(id) on delete cascade,
  tier             text not null default 'free',   -- free|starter|plus|pro|max
  status           text not null default 'active',  -- active|past_due|cancelled|expired
  cashfree_sub_id  text,
  cashfree_plan_id text,
  mandate_status   text,
  period_end       integer,                         -- unix seconds
  updated_at       text not null default (datetime('now'))
);

-- User's chosen strategies (desired state). params NULL unless Max tier customizes.
create table if not exists user_strategies (
  id         text primary key,
  user_id    text not null references user(id) on delete cascade,
  template   text not null,
  market     text not null,
  params     text,                                  -- JSON string or NULL
  enabled    integer not null default 1,
  position   integer not null default 0,            -- ordering for the max_active cap
  created_at text not null default (datetime('now'))
);
create index if not exists user_strategies_user on user_strategies(user_id);

-- Desired runtime + liveness. active=on/off; live=DRY_RUN(0)/LIVE(1). Two-switch default DRY_RUN.
create table if not exists bot_state (
  user_id        text primary key references user(id) on delete cascade,
  active         integer not null default 0,
  live           integer not null default 0,
  last_heartbeat integer,                           -- unix seconds
  last_error     text,
  updated_at     text not null default (datetime('now'))
);

-- Per-user notification preferences. No row => email on, telegram off (back-compat: existing
-- users keep getting fill emails). telegram_chat_id is the numeric chat id from @userinfobot;
-- the app sends via the shared TELEGRAM_BOT_TOKEN bot the user has started a chat with.
-- currency is the user's preferred display currency (ISO code, default INR).
create table if not exists notification_prefs (
  user_id          text primary key references user(id) on delete cascade,
  email_enabled    integer not null default 1,
  telegram_enabled integer not null default 0,
  telegram_chat_id text,
  currency         text not null default 'INR',
  updated_at       text not null default (datetime('now'))
);

-- Observed state, projected from each engine's SQLite by the supervisor (read model).
create table if not exists trades (
  id              text primary key,
  user_id         text not null references user(id) on delete cascade,
  client_order_id text not null,
  strategy        text not null,
  market          text not null,
  side            text not null,
  qty             real not null,
  price           real not null,
  notional        real not null,
  status          text not null,
  dry_run         integer not null,
  realized_pnl    real not null default 0,
  tds             real not null default 0,
  ts              text not null,
  unique (user_id, client_order_id)
);
create index if not exists trades_user_ts on trades(user_id, ts desc);

create table if not exists positions (
  user_id   text not null references user(id) on delete cascade,
  strategy  text not null,
  market    text not null,
  qty       real not null,
  avg_price real not null,
  primary key (user_id, strategy, market)
);

create table if not exists equity_snapshots (
  id             integer primary key autoincrement,
  user_id        text not null references user(id) on delete cascade,
  equity         real not null,
  free           real not null,
  realized_today real not null,
  trades_today   integer not null,
  ts             text not null default (datetime('now'))
);
create index if not exists equity_user_ts on equity_snapshots(user_id, ts desc);

-- Cashfree webhook idempotency (Phase 3).
create table if not exists billing_events (
  id                text primary key,
  user_id           text references user(id) on delete set null,
  cashfree_event_id text unique not null,
  type              text not null,
  raw               text not null,                  -- JSON string
  ts                text not null default (datetime('now'))
);
