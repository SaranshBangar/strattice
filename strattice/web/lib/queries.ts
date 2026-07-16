// App data access on D1 (raw SQL). Server-only (uses the master key for credential crypto).
import "server-only";
import { randomUUID } from "crypto";
import { d1Query, d1First } from "./d1";
import { encrypt } from "./crypto";
import { resolveTier, isAllowed, type Tier } from "./entitlements";

// ---------- subscription / tier ----------
export interface SubRow {
  tier: string;
  status: string;
  period_end: number | null;
  cashfree_sub_id: string | null;
}

export async function getSubscription(userId: string): Promise<SubRow | null> {
  return d1First<SubRow>(
    "select tier, status, period_end, cashfree_sub_id from subscriptions where user_id = ?",
    [userId],
  );
}

/** Entitled while period hasn't ended and the sub isn't dead. 'cancelled' keeps access until
 *  period_end (grace), 'past_due'/'expired' do not. No row -> free. */
export async function effectiveTier(userId: string): Promise<Tier> {
  const row = await getSubscription(userId);
  if (!row) return resolveTier("free");
  const live = row.period_end != null && row.period_end > Date.now() / 1000;
  const ok = live && (row.status === "active" || row.status === "cancelled");
  return resolveTier(ok ? row.tier : "free");
}

export async function createPendingSubscription(
  userId: string,
  cashfreeSubId: string,
  tier: string,
) {
  await d1Query(
    `insert into subscriptions(user_id, tier, status, cashfree_sub_id, period_end, updated_at)
     values (?,?, 'pending', ?, null, datetime('now'))
     on conflict(user_id) do update set tier=excluded.tier, status='pending',
       cashfree_sub_id=excluded.cashfree_sub_id, updated_at=datetime('now')`,
    [userId, tier, cashfreeSubId],
  );
}

/** Email + name for a user, for notifications. `created_at` is unix seconds. */
export async function getUserContact(
  userId: string,
): Promise<{
  email: string;
  name: string | null;
  created_at: number | null;
} | null> {
  return d1First<{
    email: string;
    name: string | null;
    created_at: number | null;
  }>("select email, name, createdAt as created_at from user where id = ?", [
    userId,
  ]);
}

// ---------- notification preferences ----------
export interface NotificationPrefs {
  email_enabled: number; // 0/1
  telegram_enabled: number; // 0/1
  telegram_chat_id: string | null;
}

const DEFAULT_PREFS: NotificationPrefs = {
  email_enabled: 1,
  telegram_enabled: 0,
  telegram_chat_id: null,
};

// notification_prefs shipped after the original schema, so deployed D1 databases may not
// have it yet (schema.sql is applied manually with wrangler). Rather than 500 the account
// page until someone runs the migration, create the table on first miss and retry -
// the DDL is byte-identical to strattice/db/schema.sql and idempotent.
const PREFS_DDL = `create table if not exists notification_prefs (
  user_id          text primary key references user(id) on delete cascade,
  email_enabled    integer not null default 1,
  telegram_enabled integer not null default 0,
  telegram_chat_id text,
  currency         text not null default 'INR',
  updated_at       text not null default (datetime('now'))
)`;

// currency shipped after notification_prefs itself, so deployed tables may lack the column.
const CURRENCY_DDL = `alter table notification_prefs add column currency text not null default 'INR'`;

async function withPrefsTable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = String(e);
    if (msg.includes("no such table: notification_prefs")) {
      await d1Query(PREFS_DDL);
      return fn();
    }
    if (msg.includes("no such column: currency")) {
      await d1Query(CURRENCY_DDL);
      return fn();
    }
    throw e;
  }
}

/** A user's notification settings. No row => email on, telegram off (existing users keep emails). */
export async function getNotificationPrefs(
  userId: string,
): Promise<NotificationPrefs> {
  const row = await withPrefsTable(() =>
    d1First<NotificationPrefs>(
      "select email_enabled, telegram_enabled, telegram_chat_id from notification_prefs where user_id = ?",
      [userId],
    ),
  );
  return row ?? { ...DEFAULT_PREFS };
}

/** Upsert only the provided fields, leaving the rest at their current (or default) value. */
export async function setNotificationPrefs(
  userId: string,
  patch: {
    emailEnabled?: boolean;
    telegramEnabled?: boolean;
    telegramChatId?: string | null;
  },
) {
  const cur = await getNotificationPrefs(userId);
  const emailEnabled = patch.emailEnabled ?? !!cur.email_enabled;
  const telegramEnabled = patch.telegramEnabled ?? !!cur.telegram_enabled;
  const chatId =
    patch.telegramChatId !== undefined
      ? patch.telegramChatId
      : cur.telegram_chat_id;
  await withPrefsTable(() =>
    d1Query(
      `insert into notification_prefs(user_id, email_enabled, telegram_enabled, telegram_chat_id, updated_at)
     values (?,?,?,?, datetime('now'))
     on conflict(user_id) do update set email_enabled=excluded.email_enabled,
       telegram_enabled=excluded.telegram_enabled, telegram_chat_id=excluded.telegram_chat_id,
       updated_at=datetime('now')`,
      [userId, emailEnabled ? 1 : 0, telegramEnabled ? 1 : 0, chatId],
    ),
  );
}

/** A user's preferred display currency. No row => INR. */
export async function getCurrency(userId: string): Promise<string> {
  const row = await withPrefsTable(() =>
    d1First<{ currency: string }>(
      "select currency from notification_prefs where user_id = ?",
      [userId],
    ),
  );
  return row?.currency ?? "INR";
}

export async function setCurrency(userId: string, currency: string) {
  await withPrefsTable(() =>
    d1Query(
      `insert into notification_prefs(user_id, currency, updated_at)
     values (?,?, datetime('now'))
     on conflict(user_id) do update set currency=excluded.currency, updated_at=datetime('now')`,
      [userId, currency],
    ),
  );
}

/** Everything the notify webhook needs for one user in a single round-trip. */
export interface NotifyTarget {
  email: string;
  email_enabled: number;
  telegram_enabled: number;
  telegram_chat_id: string | null;
}
export async function getNotifyTarget(
  userId: string,
): Promise<NotifyTarget | null> {
  return withPrefsTable(() =>
    d1First<NotifyTarget>(
      `select u.email,
            coalesce(np.email_enabled, 1) as email_enabled,
            coalesce(np.telegram_enabled, 0) as telegram_enabled,
            np.telegram_chat_id
     from user u left join notification_prefs np on np.user_id = u.id
     where u.id = ?`,
      [userId],
    ),
  );
}

export async function userIdByCashfreeSub(
  cashfreeSubId: string,
): Promise<string | null> {
  const row = await d1First<{ user_id: string }>(
    "select user_id from subscriptions where cashfree_sub_id = ?",
    [cashfreeSubId],
  );
  return row?.user_id ?? null;
}

export async function setSubscriptionStatus(
  cashfreeSubId: string,
  status: string,
  periodEndUnix?: number | null,
) {
  if (periodEndUnix === undefined) {
    await d1Query(
      "update subscriptions set status=?, updated_at=datetime('now') where cashfree_sub_id=?",
      [status, cashfreeSubId],
    );
  } else {
    await d1Query(
      "update subscriptions set status=?, period_end=?, updated_at=datetime('now') where cashfree_sub_id=?",
      [status, periodEndUnix, cashfreeSubId],
    );
  }
}

/** Idempotency guard for webhooks. True if this is the first time we've seen the event. */
export async function recordBillingEvent(
  eventId: string,
  userId: string | null,
  type: string,
  raw: string,
): Promise<boolean> {
  const { randomUUID } = await import("crypto");
  const rows = await d1Query(
    `insert into billing_events(id, user_id, cashfree_event_id, type, raw)
     values (?,?,?,?,?) on conflict(cashfree_event_id) do nothing returning id`,
    [randomUUID(), userId, eventId, type, raw],
  );
  return rows.length > 0;
}

// ---------- credentials ----------
export async function credentialsLinked(
  userId: string,
): Promise<{ linked: boolean; label?: string }> {
  const row = await d1First<{ key_label: string }>(
    "select key_label from exchange_credentials where user_id = ?",
    [userId],
  );
  return row ? { linked: true, label: row.key_label } : { linked: false };
}

export async function saveCredentials(
  userId: string,
  apiKey: string,
  secret: string,
  label: string,
) {
  const [k, s] = await Promise.all([encrypt(apiKey), encrypt(secret)]);
  await d1Query(
    `insert into exchange_credentials(user_id, api_key_enc, secret_enc, key_label)
     values (?,?,?,?)
     on conflict(user_id) do update set api_key_enc=excluded.api_key_enc,
       secret_enc=excluded.secret_enc, key_label=excluded.key_label`,
    [userId, k, s, label || "default"],
  );
}

// ---------- strategies ----------
export interface StrategyRow {
  id: string;
  template: string;
  market: string;
  params: string | null;
  enabled: number;
  position: number;
  weight: number;
}
export async function listStrategies(userId: string): Promise<StrategyRow[]> {
  return d1Query<StrategyRow>(
    "select id, template, market, params, enabled, position, weight from user_strategies where user_id = ? order by position",
    [userId],
  );
}

export async function addStrategy(
  userId: string,
  template: string,
  market: string,
  params?: string | null,
) {
  const [tier, rows] = await Promise.all([
    effectiveTier(userId),
    listStrategies(userId),
  ]);
  if (!isAllowed(tier, template))
    throw new Error(`${template} not allowed on the ${tier.name} plan`);
  const enabledCount = rows.filter((r) => r.enabled).length;
  // new strategies start enabled only if there's room under the cap; else added disabled.
  const enabled =
    tier.maxActive === null || enabledCount < tier.maxActive ? 1 : 0;
  const pos = rows.length;
  await d1Query(
    "insert into user_strategies(id,user_id,template,market,enabled,position,params) values (?,?,?,?,?,?,?)",
    [randomUUID(), userId, template, market, enabled, pos, params ?? null],
  );
}

export async function setStrategyEnabled(
  userId: string,
  id: string,
  enabled: boolean,
) {
  if (enabled) {
    const [tier, rows] = await Promise.all([
      effectiveTier(userId),
      listStrategies(userId),
    ]);
    const enabledCount = rows.filter((r) => r.enabled && r.id !== id).length;
    if (tier.maxActive !== null && enabledCount >= tier.maxActive)
      throw new Error(
        `Plan ${tier.name} allows ${tier.maxActive} active strategies`,
      );
  }
  await d1Query(
    "update user_strategies set enabled = ? where id = ? and user_id = ?",
    [enabled ? 1 : 0, id, userId],
  );
}

// Capital split among a user's enabled strategies. Weights are relative, not
// percentages - bot/sizing.py normalizes by their sum, so {a: 1, b: 1} and
// {a: 50, b: 50} behave identically. Only rows the caller passes are touched.
export async function setStrategyWeights(
  userId: string,
  weights: Record<string, number>,
) {
  await Promise.all(
    Object.entries(weights).map(([id, weight]) =>
      d1Query(
        "update user_strategies set weight = ? where id = ? and user_id = ?",
        [weight, id, userId],
      ),
    ),
  );
}

export async function removeStrategy(userId: string, id: string) {
  await d1Query("delete from user_strategies where id = ? and user_id = ?", [
    id,
    userId,
  ]);
}

// ---------- bot state ----------
export interface BotState {
  active: number;
  live: number;
  last_heartbeat: number | null;
  last_error: string | null;
}
export async function getBotState(userId: string): Promise<BotState> {
  const row = await d1First<BotState>(
    "select active, live, last_heartbeat, last_error from bot_state where user_id = ?",
    [userId],
  );
  return row ?? { active: 0, live: 0, last_heartbeat: null, last_error: null };
}
export async function setBotState(
  userId: string,
  patch: { active?: boolean; live?: boolean },
) {
  // Single upsert instead of a read-then-merge-then-write: unspecified fields are bound
  // as SQL NULL and `coalesce`d against the existing row (or the column default on first
  // insert), so a patch touching only one field never has to fetch the other one first.
  // Safe because active/live are non-nullable booleans - there's no real value that could
  // be confused with "not provided" (contrast with notification_prefs.telegram_chat_id,
  // which IS legitimately nullable and keeps its read-then-write for that reason).
  const activeVal = patch.active === undefined ? null : patch.active ? 1 : 0;
  const liveVal = patch.live === undefined ? null : patch.live ? 1 : 0;
  await d1Query(
    `insert into bot_state(user_id, active, live) values (?, coalesce(?, 0), coalesce(?, 0))
     on conflict(user_id) do update set
       active = coalesce(?, active),
       live = coalesce(?, live),
       updated_at = datetime('now')`,
    [userId, activeVal, liveVal, activeVal, liveVal],
  );
}

// ---------- dashboard read model ----------
// Only orders that actually executed (live fills + simulated DRY_RUN fills) count toward
// money. Rejected/errored orders stay visible in the trade log but never in P&L math.
const EXECUTED = "status in ('placed','dry_run')";

export async function recentTrades(userId: string, n = 30) {
  return d1Query(
    "select strategy, market, side, qty, price, notional, status, realized_pnl, tds, dry_run, ts from trades where user_id = ? order by ts desc limit ?",
    [userId, n],
  );
}
export async function openPositions(userId: string) {
  return d1Query(
    "select strategy, market, qty, avg_price from positions where user_id = ? and qty != 0",
    [userId],
  );
}
export async function latestEquity(userId: string) {
  return d1First<{
    equity: number;
    free: number;
    unrealized_pnl: number;
    realized_today: number;
    trades_today: number;
    ts: string;
  }>(
    "select equity, free, unrealized_pnl, realized_today, trades_today, ts from equity_snapshots where user_id = ? order by ts desc limit 1",
    [userId],
  );
}

// ---------- analytics read model (charts) ----------
export interface EquityPoint {
  ts: string;
  equity: number;
  free: number;
  unrealized_pnl: number;
  realized_today: number;
}
/** Equity snapshots in chronological order for the equity curve. */
export async function equitySeries(
  userId: string,
  limit = 240,
): Promise<EquityPoint[]> {
  const rows = await d1Query<EquityPoint>(
    "select ts, equity, free, unrealized_pnl, realized_today from equity_snapshots where user_id = ? order by ts desc limit ?",
    [userId, limit],
  );
  return rows.reverse();
}

export interface DailyPnl {
  day: string;
  pnl: number;
  trades: number;
}
/** Realized P&L grouped by calendar day (UTC), chronological. Executed orders only. */
export async function dailyPnl(userId: string, days = 30): Promise<DailyPnl[]> {
  const rows = await d1Query<DailyPnl>(
    `select substr(ts,1,10) as day, coalesce(sum(realized_pnl),0) as pnl, count(*) as trades
     from trades where user_id = ? and ${EXECUTED} group by substr(ts,1,10) order by day desc limit ?`,
    [userId, days],
  );
  return rows.reverse();
}

export interface StrategyStat {
  strategy: string;
  market: string;
  trades: number;
  pnl: number;
  wins: number;
  losses: number;
}
/** Per-strategy, per-market aggregates. Grouped by market too, not just template, so
 *  running the same template on two markets doesn't hide which one is losing money.
 *  Wins/losses are counted on closing (sell) legs only - buy legs book their entry fee
 *  as a small negative realized_pnl, which is a cost, not a lost trade. */
export async function strategyBreakdown(
  userId: string,
): Promise<StrategyStat[]> {
  return d1Query<StrategyStat>(
    `select strategy, market, count(*) as trades, coalesce(sum(realized_pnl),0) as pnl,
            coalesce(sum(case when side = 'sell' and realized_pnl > 0 then 1 else 0 end),0) as wins,
            coalesce(sum(case when side = 'sell' and realized_pnl < 0 then 1 else 0 end),0) as losses
     from trades where user_id = ? and ${EXECUTED} group by strategy, market order by pnl desc`,
    [userId],
  );
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  pnl: number;
  tds: number;
  best: number;
  worst: number;
  volume: number;
  livePnl: number;
  paperPnl: number;
  liveTrades: number;
  paperTrades: number;
}
/** All-time trade aggregates for the dashboard header. */
// ---------- admin (owner-only; every caller re-checks requireAdmin first) ----------
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  created_at: number | null;
  tier: string;
  status: string;
  period_end: number | null;
  bot_active: number;
  bot_live: number;
  last_heartbeat: number | null;
  linked: number;
  trades: number;
}

const NOW_S = "cast(strftime('%s','now') as integer)";
const PAYING = `s.status in ('active','cancelled') and s.period_end is not null and s.period_end > ${NOW_S}`;

export async function listUsersAdmin(
  search = "",
  page = 1,
  pageSize = 20,
): Promise<{
  rows: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(5, pageSize));
  const like = `%${search.trim().toLowerCase()}%`;
  const [countRow, rows] = await Promise.all([
    d1First<{ n: number }>(
      "select count(*) as n from user where lower(email) like ?",
      [like],
    ),
    d1Query<AdminUser>(
      `select u.id, u.email, u.name, u.createdAt as created_at,
              coalesce(s.tier,'free') as tier, coalesce(s.status,'-') as status, s.period_end,
              coalesce(b.active,0) as bot_active, coalesce(b.live,0) as bot_live, b.last_heartbeat,
              (case when c.user_id is not null then 1 else 0 end) as linked,
              (select count(*) from trades t where t.user_id = u.id) as trades
       from user u
       left join subscriptions s on s.user_id = u.id
       left join bot_state b on b.user_id = u.id
       left join exchange_credentials c on c.user_id = u.id
       where lower(u.email) like ?
       order by u.createdAt desc
       limit ? offset ?`,
      [like, size, (p - 1) * size],
    ),
  ]);
  return { rows, total: countRow?.n ?? 0, page: p, pageSize: size };
}

export interface AdminStats {
  users: number;
  paying: number;
  activeBots: number;
  liveBots: number;
  trades: number;
  byTier: Record<string, number>;
}
export async function adminStats(): Promise<AdminStats> {
  const [tot, pay, bots, trades, tiers] = await Promise.all([
    d1First<{ n: number }>("select count(*) as n from user"),
    d1First<{ n: number }>(
      `select count(*) as n from subscriptions s where ${PAYING}`,
    ),
    d1First<{ active: number; live: number }>(
      "select coalesce(sum(active),0) as active, coalesce(sum(case when active=1 and live=1 then 1 else 0 end),0) as live from bot_state",
    ),
    d1First<{ n: number }>("select count(*) as n from trades"),
    d1Query<{ tier: string; n: number }>(
      `select s.tier as tier, count(*) as n from subscriptions s where ${PAYING} group by s.tier`,
    ),
  ]);
  const byTier: Record<string, number> = {};
  for (const t of tiers) byTier[t.tier] = t.n;
  return {
    users: tot?.n ?? 0,
    paying: pay?.n ?? 0,
    activeBots: bots?.active ?? 0,
    liveBots: bots?.live ?? 0,
    trades: trades?.n ?? 0,
    byTier,
  };
}

/** Manually grant/downgrade a plan. Paid tiers get a 30-day comp window; 'free' clears it. */
export async function adminSetTier(userId: string, tier: string) {
  const free = tier === "free";
  const periodEnd = free
    ? null
    : Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  await d1Query(
    `insert into subscriptions(user_id, tier, status, period_end, updated_at)
     values (?,?, 'active', ?, datetime('now'))
     on conflict(user_id) do update set tier=excluded.tier, status='active',
       period_end=excluded.period_end, updated_at=datetime('now')`,
    [userId, tier, periodEnd],
  );
}

/** Owner kill-switch: force a user's bot off (supervisor stops it within one poll). */
export async function adminDisableBot(userId: string) {
  await d1Query(
    `insert into bot_state(user_id, active, live) values (?,0,0)
     on conflict(user_id) do update set active=0, live=0, updated_at=datetime('now')`,
    [userId],
  );
}

/** All-time aggregates over executed orders. Wins/losses count sell legs only (see
 *  strategyBreakdown); live and paper P&L are kept apart so real money is never
 *  averaged with DRY_RUN simulations in a headline number. */
export async function tradeStats(userId: string): Promise<TradeStats> {
  const row = await d1First<TradeStats>(
    `select count(*) as total,
            coalesce(sum(case when side = 'sell' and realized_pnl > 0 then 1 else 0 end),0) as wins,
            coalesce(sum(case when side = 'sell' and realized_pnl < 0 then 1 else 0 end),0) as losses,
            coalesce(sum(realized_pnl),0) as pnl,
            coalesce(sum(tds),0) as tds,
            coalesce(max(realized_pnl),0) as best,
            coalesce(min(realized_pnl),0) as worst,
            coalesce(sum(notional),0) as volume,
            coalesce(sum(case when dry_run = 0 then realized_pnl else 0 end),0) as livePnl,
            coalesce(sum(case when dry_run = 1 then realized_pnl else 0 end),0) as paperPnl,
            coalesce(sum(case when dry_run = 0 then 1 else 0 end),0) as liveTrades,
            coalesce(sum(case when dry_run = 1 then 1 else 0 end),0) as paperTrades
     from trades where user_id = ? and ${EXECUTED}`,
    [userId],
  );
  return (
    row ?? {
      total: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
      tds: 0,
      best: 0,
      worst: 0,
      volume: 0,
      livePnl: 0,
      paperPnl: 0,
      liveTrades: 0,
      paperTrades: 0,
    }
  );
}

// ---------- tax read model (India VDA) ----------
export interface TaxSummary {
  sells: number;
  consideration: number;
  gains: number;
  losses: number;
  tds: number;
}
/** Indian financial-year window [Apr 1, Mar 31] for a date, as ISO bounds + label. */
export function financialYear(now = new Date()): {
  startISO: string;
  endISO: string;
  label: string;
} {
  const y =
    now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    startISO: `${y}-04-01`,
    endISO: `${y + 1}-04-01`,
    label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`,
  };
}

/** LIVE sell legs inside a financial year - the trades that are actual tax events.
 *  Gains and losses are summed separately because section 115BBH does not allow
 *  offsetting VDA losses against VDA gains. Indicative only, not tax advice. */
export async function taxSummary(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<TaxSummary> {
  const row = await d1First<TaxSummary>(
    `select count(*) as sells,
            coalesce(sum(notional),0) as consideration,
            coalesce(sum(case when realized_pnl > 0 then realized_pnl else 0 end),0) as gains,
            coalesce(sum(case when realized_pnl < 0 then realized_pnl else 0 end),0) as losses,
            coalesce(sum(tds),0) as tds
     from trades
     where user_id = ? and dry_run = 0 and status = 'placed' and side = 'sell'
       and ts >= ? and ts < ?`,
    [userId, startISO, endISO],
  );
  return row ?? { sells: 0, consideration: 0, gains: 0, losses: 0, tds: 0 };
}

export interface TaxReportRow {
  ts: string;
  strategy: string;
  market: string;
  qty: number;
  price: number;
  notional: number;
  realized_pnl: number;
  tds: number;
}
/** Every LIVE sell leg in the FY, oldest first, for the downloadable tax CSV. */
export async function taxReportRows(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<TaxReportRow[]> {
  return d1Query<TaxReportRow>(
    `select ts, strategy, market, qty, price, notional, realized_pnl, tds
     from trades
     where user_id = ? and dry_run = 0 and status = 'placed' and side = 'sell'
       and ts >= ? and ts < ?
     order by ts asc`,
    [userId, startISO, endISO],
  );
}
