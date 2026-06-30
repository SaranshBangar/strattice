// App data access on D1 (raw SQL). Server-only (uses the master key for credential crypto).
import "server-only";
import { randomUUID } from "crypto";
import { d1Query, d1First } from "./d1";
import { encrypt } from "./crypto";
import { resolveTier, isAllowed, type Tier } from "./entitlements";

// ---------- subscription / tier ----------
export interface SubRow { tier: string; status: string; period_end: number | null; cashfree_sub_id: string | null; }

export async function getSubscription(userId: string): Promise<SubRow | null> {
  return d1First<SubRow>(
    "select tier, status, period_end, cashfree_sub_id from subscriptions where user_id = ?", [userId]);
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

export async function createPendingSubscription(userId: string, cashfreeSubId: string, tier: string) {
  await d1Query(
    `insert into subscriptions(user_id, tier, status, cashfree_sub_id, period_end, updated_at)
     values (?,?, 'pending', ?, null, datetime('now'))
     on conflict(user_id) do update set tier=excluded.tier, status='pending',
       cashfree_sub_id=excluded.cashfree_sub_id, updated_at=datetime('now')`,
    [userId, tier, cashfreeSubId]);
}

export async function userIdByCashfreeSub(cashfreeSubId: string): Promise<string | null> {
  const row = await d1First<{ user_id: string }>(
    "select user_id from subscriptions where cashfree_sub_id = ?", [cashfreeSubId]);
  return row?.user_id ?? null;
}

export async function setSubscriptionStatus(
  cashfreeSubId: string, status: string, periodEndUnix?: number | null,
) {
  if (periodEndUnix === undefined) {
    await d1Query("update subscriptions set status=?, updated_at=datetime('now') where cashfree_sub_id=?",
      [status, cashfreeSubId]);
  } else {
    await d1Query(
      "update subscriptions set status=?, period_end=?, updated_at=datetime('now') where cashfree_sub_id=?",
      [status, periodEndUnix, cashfreeSubId]);
  }
}

/** Idempotency guard for webhooks. True if this is the first time we've seen the event. */
export async function recordBillingEvent(
  eventId: string, userId: string | null, type: string, raw: string,
): Promise<boolean> {
  const { randomUUID } = await import("crypto");
  const rows = await d1Query(
    `insert into billing_events(id, user_id, cashfree_event_id, type, raw)
     values (?,?,?,?,?) on conflict(cashfree_event_id) do nothing returning id`,
    [randomUUID(), userId, eventId, type, raw]);
  return rows.length > 0;
}

// ---------- credentials ----------
export async function credentialsLinked(userId: string): Promise<{ linked: boolean; label?: string }> {
  const row = await d1First<{ key_label: string }>(
    "select key_label from exchange_credentials where user_id = ?", [userId]);
  return row ? { linked: true, label: row.key_label } : { linked: false };
}

export async function saveCredentials(userId: string, apiKey: string, secret: string, label: string) {
  const [k, s] = [await encrypt(apiKey), await encrypt(secret)];
  await d1Query(
    `insert into exchange_credentials(user_id, api_key_enc, secret_enc, key_label)
     values (?,?,?,?)
     on conflict(user_id) do update set api_key_enc=excluded.api_key_enc,
       secret_enc=excluded.secret_enc, key_label=excluded.key_label`,
    [userId, k, s, label || "default"]);
}

// ---------- strategies ----------
export interface StrategyRow {
  id: string; template: string; market: string; params: string | null; enabled: number; position: number;
}
export async function listStrategies(userId: string): Promise<StrategyRow[]> {
  return d1Query<StrategyRow>(
    "select id, template, market, params, enabled, position from user_strategies where user_id = ? order by position",
    [userId]);
}

export async function addStrategy(userId: string, template: string, market: string) {
  const tier = await effectiveTier(userId);
  if (!isAllowed(tier, template)) throw new Error(`${template} not allowed on the ${tier.name} plan`);
  const rows = await listStrategies(userId);
  const enabledCount = rows.filter((r) => r.enabled).length;
  // new strategies start enabled only if there's room under the cap; else added disabled.
  const enabled = tier.maxActive === null || enabledCount < tier.maxActive ? 1 : 0;
  const pos = rows.length;
  await d1Query(
    "insert into user_strategies(id,user_id,template,market,enabled,position) values (?,?,?,?,?,?)",
    [randomUUID(), userId, template, market, enabled, pos]);
}

export async function setStrategyEnabled(userId: string, id: string, enabled: boolean) {
  if (enabled) {
    const tier = await effectiveTier(userId);
    const rows = await listStrategies(userId);
    const enabledCount = rows.filter((r) => r.enabled && r.id !== id).length;
    if (tier.maxActive !== null && enabledCount >= tier.maxActive)
      throw new Error(`Plan ${tier.name} allows ${tier.maxActive} active strategies`);
  }
  await d1Query("update user_strategies set enabled = ? where id = ? and user_id = ?",
    [enabled ? 1 : 0, id, userId]);
}

export async function removeStrategy(userId: string, id: string) {
  await d1Query("delete from user_strategies where id = ? and user_id = ?", [id, userId]);
}

// ---------- bot state ----------
export interface BotState { active: number; live: number; last_heartbeat: number | null; last_error: string | null; }
export async function getBotState(userId: string): Promise<BotState> {
  const row = await d1First<BotState>(
    "select active, live, last_heartbeat, last_error from bot_state where user_id = ?", [userId]);
  return row ?? { active: 0, live: 0, last_heartbeat: null, last_error: null };
}
export async function setBotState(userId: string, patch: { active?: boolean; live?: boolean }) {
  // upsert; only overwrite provided fields
  const cur = await getBotState(userId);
  const active = patch.active ?? !!cur.active;
  const live = patch.live ?? !!cur.live;
  await d1Query(
    `insert into bot_state(user_id, active, live) values (?,?,?)
     on conflict(user_id) do update set active=excluded.active, live=excluded.live,
       updated_at=datetime('now')`,
    [userId, active ? 1 : 0, live ? 1 : 0]);
}

// ---------- dashboard read model ----------
export async function recentTrades(userId: string, n = 30) {
  return d1Query(
    "select strategy, market, side, qty, price, notional, status, realized_pnl, tds, ts from trades where user_id = ? order by ts desc limit ?",
    [userId, n]);
}
export async function openPositions(userId: string) {
  return d1Query("select strategy, market, qty, avg_price from positions where user_id = ? and qty != 0", [userId]);
}
export async function latestEquity(userId: string) {
  return d1First<{ equity: number; free: number; realized_today: number; trades_today: number; ts: string }>(
    "select equity, free, realized_today, trades_today, ts from equity_snapshots where user_id = ? order by ts desc limit 1",
    [userId]);
}
