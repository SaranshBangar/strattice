"use server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getUser, requireUserId, requireAdmin } from "@/lib/session";
import * as q from "@/lib/queries";
import {
  createSubscription,
  cancelSubscription,
  cashfreeMode,
} from "@/lib/cashfree";
import {
  PAID_TIERS,
  TIERS,
  ACTIVE_TEMPLATES,
  EXPERIMENTAL_TEMPLATES,
  type TierName,
  type PickableTemplate,
} from "@/lib/entitlements";
import { sanitizeParams } from "@/lib/strategy-sim";
import { GO_LIVE_PHRASE } from "@/lib/risk";
import { sanitizeCustomDef } from "@/lib/custom-strategy";
import { sendApiKeyEmail } from "@/lib/email";
import { sendTelegram, telegramConfigured, table } from "@/lib/telegram";
import { isCurrencyCode } from "@/lib/currencies";

export async function saveCredentialsAction(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("unauthorized");
  const apiKey = String(formData.get("apiKey") || "").trim();
  const secret = String(formData.get("secret") || "").trim();
  const label = String(formData.get("label") || "default").trim();
  if (!apiKey || !secret) throw new Error("API key and secret required");
  await q.saveCredentials(user.id, apiKey, secret, label);
  await sendApiKeyEmail(user.email, label || "default");
  revalidatePath("/account");
}

// Validate + sanitize one (template, market, rawParams) into an insert-ready row.
// params are user input: re-validate server-side regardless of what the UI enforced.
function prepareStrategyInsert(
  template: string,
  marketRaw: string,
  rawParams: unknown,
): { template: string; market: string; params: string | null } {
  const market = String(marketRaw || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(market))
    throw new Error(`Enter a valid market id, e.g. I-BTC_INR (got "${market}")`);

  let params: string | null = null;
  if (template === "custom") {
    params = JSON.stringify(sanitizeCustomDef(String(rawParams ?? "")));
  } else {
    // New adds are restricted to ACTIVE/EXPERIMENTAL templates: retired ones (mean
    // reversion) keep resolving for legacy rows but can no longer be added.
    if (
      !(ACTIVE_TEMPLATES as readonly string[]).includes(template) &&
      !(EXPERIMENTAL_TEMPLATES as readonly string[]).includes(template)
    )
      throw new Error("unknown template");
    if (rawParams) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(rawParams));
      } catch {
        throw new Error("Invalid strategy parameters.");
      }
      const clean = sanitizeParams(template as PickableTemplate, parsed);
      params = clean ? JSON.stringify(clean) : null;
    }
  }
  return { template, market, params };
}

/** Add one template across several coins, or several distinct template+market pairs,
 *  in a single call. Backs both the multi-coin add form and the "best strategy"
 *  cross-coin comparison, which each add several rows at once. */
export async function addStrategiesAction(
  items: { template: string; market: string; params?: string | null }[],
) {
  const userId = await requireUserId();
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("Select at least one coin.");
  if (items.length > 60) throw new Error("Too many strategies at once.");
  const prepared = items.map((it) =>
    prepareStrategyInsert(String(it.template), it.market, it.params ?? null),
  );
  for (const p of prepared)
    await q.addStrategy(userId, p.template, p.market, p.params);
  revalidatePath("/strategies");
}

export async function toggleStrategyAction(id: string, enabled: boolean) {
  const userId = await requireUserId();
  await q.setStrategyEnabled(userId, id, enabled);
  revalidatePath("/strategies");
}

export async function removeStrategyAction(id: string) {
  const userId = await requireUserId();
  await q.removeStrategy(userId, id);
  revalidatePath("/strategies");
}

export async function setStrategyWeightsAction(weights: Record<string, number>) {
  const userId = await requireUserId();
  for (const w of Object.values(weights)) {
    if (!Number.isFinite(w) || w <= 0) throw new Error("Weights must be positive numbers");
  }
  await q.setStrategyWeights(userId, weights);
  revalidatePath("/strategies");
}

// The supervisor turns bot_state.live into the engine's DRY_RUN=false +
// LIVE_TRADING_CONFIRM pair, so this flag alone arms real-money trading. Enabling it
// therefore goes through goLiveAction (typed confirmation + preconditions); this action
// only turns things ON with linked keys, and always allows turning things OFF -
// the off direction is a safety control and must never be gated.
export async function setBotAction(patch: {
  active?: boolean;
  live?: boolean;
}) {
  const userId = await requireUserId();
  if (patch.live === true)
    throw new Error("Enabling live trading requires confirmation.");
  if (patch.active === true) {
    const creds = await q.credentialsLinked(userId);
    if (!creds.linked)
      throw new Error("Link your CoinDCX API keys before turning the bot on.");
  }
  await q.setBotState(userId, patch);
  revalidatePath("/account");
  revalidatePath("/dashboard");
}

/** The only path that arms real-money trading. Mirrors the bot's own double-lock
 *  (DRY_RUN=false + LIVE_TRADING_CONFIRM): keys must be linked, at least one strategy
 *  enabled, and the user must have typed the confirmation phrase. */
export async function goLiveAction(confirmPhrase: string) {
  const userId = await requireUserId();
  if (confirmPhrase.trim().toUpperCase() !== GO_LIVE_PHRASE)
    throw new Error(`Type "${GO_LIVE_PHRASE}" to confirm.`);
  const [creds, strategies] = await Promise.all([
    q.credentialsLinked(userId),
    q.listStrategies(userId),
  ]);
  if (!creds.linked)
    throw new Error("Link your CoinDCX API keys before going live.");
  if (!strategies.some((s) => s.enabled))
    throw new Error("Enable at least one strategy before going live.");
  await q.setBotState(userId, { live: true });
  revalidatePath("/account");
  revalidatePath("/dashboard");
}

// ---------- notification preferences ----------
export async function getNotificationPrefsAction() {
  const userId = await requireUserId();
  const p = await q.getNotificationPrefs(userId);
  return {
    emailEnabled: !!p.email_enabled,
    telegramEnabled: !!p.telegram_enabled,
    telegramChatId: p.telegram_chat_id ?? "",
    telegramConfigured: telegramConfigured(),
  };
}

export async function setEmailNotificationsAction(enabled: boolean) {
  const userId = await requireUserId();
  await q.setNotificationPrefs(userId, { emailEnabled: enabled });
  revalidatePath("/settings");
}

/** Save (and enable) a Telegram chat id. Sends a confirmation message so the user gets
 *  immediate proof the id + bot chat are wired up; a failed send is reported, not fatal. */
export async function saveTelegramNotificationsAction(
  chatId: string,
): Promise<{ ok: true; test: "sent" | "failed" | "unconfigured" }> {
  const userId = await requireUserId();
  const id = chatId.trim();
  if (!/^-?\d{5,20}$/.test(id)) {
    throw new Error(
      "Enter the numeric chat id from @userinfobot (digits only).",
    );
  }
  await q.setNotificationPrefs(userId, {
    telegramEnabled: true,
    telegramChatId: id,
  });
  const res = await sendTelegram(
    id,
    table("Strattice connected", [
      ["Alerts", "on"],
      ["You'll get", "buy / sell fills"],
    ]),
  );
  const test = res.ok
    ? "sent"
    : res.reason === "unconfigured"
      ? "unconfigured"
      : "failed";
  revalidatePath("/settings");
  return { ok: true, test };
}

export async function removeTelegramNotificationsAction() {
  const userId = await requireUserId();
  await q.setNotificationPrefs(userId, {
    telegramEnabled: false,
    telegramChatId: null,
  });
  revalidatePath("/settings");
}

export async function setCurrencyAction(currency: string) {
  const userId = await requireUserId();
  if (!isCurrencyCode(currency)) throw new Error("Unknown currency.");
  await q.setCurrency(userId, currency);
  revalidatePath("/settings");
}

// ---------- billing (Cashfree) ----------
// Pricing is disabled for now (the platform is fully free); checkout is kept behind this
// guard so the plumbing survives for when plans return, but nothing can start a mandate.
const PRICING_ENABLED = false;

export async function startSubscriptionAction(tier: string, phone: string) {
  if (!PRICING_ENABLED)
    throw new Error(
      "Strattice is free right now - there is nothing to subscribe to.",
    );
  const user = await getUser();
  if (!user) throw new Error("unauthorized");
  if (!PAID_TIERS.includes(tier as TierName)) throw new Error("invalid tier");
  if (!/^\d{10}$/.test(phone)) throw new Error("enter a 10-digit phone number");

  const subscriptionId = `sub_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const base = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  const res = await createSubscription({
    subscriptionId,
    tier: tier as Exclude<TierName, "free">,
    customer: { name: user.name || user.email, email: user.email, phone },
    returnUrl: `${base}/billing?sub=${subscriptionId}`,
  });
  // record pending locally; access is granted only when the webhook confirms payment.
  await q.createPendingSubscription(user.id, subscriptionId, tier);
  return { sessionId: res.subscription_session_id, mode: cashfreeMode };
}

export async function cancelSubscriptionAction() {
  const userId = await requireUserId();
  const sub = await q.getSubscription(userId);
  if (!sub?.cashfree_sub_id) throw new Error("no active subscription");
  await cancelSubscription(sub.cashfree_sub_id);
  // keep access until period_end (grace); webhook will also confirm.
  await q.setSubscriptionStatus(sub.cashfree_sub_id, "cancelled");
  revalidatePath("/billing");
}

// ---------- admin (owner-only) ----------
export async function adminSetTierAction(userId: string, tier: string) {
  await requireAdmin();
  if (!(tier in TIERS)) throw new Error("invalid tier");
  await q.adminSetTier(userId, tier);
  revalidatePath("/admin");
}

export async function adminDisableBotAction(userId: string) {
  await requireAdmin();
  await q.adminDisableBot(userId);
  revalidatePath("/admin");
}

// ---------- supervisor control (owner-only) ----------
// Start/stop/restart the shared supervisor process from the admin console. Because the app
// only reaches the supervisor through D1, "stop" means pause (stop every engine but keep the
// loop polling so "start" can resume it) rather than kill the OS process. All three take
// effect on the supervisor's next poll.
export async function adminStartSupervisorAction() {
  await requireAdmin();
  await q.setSupervisorDesiredState("running");
  revalidatePath("/admin");
}

export async function adminStopSupervisorAction() {
  await requireAdmin();
  await q.setSupervisorDesiredState("paused");
  revalidatePath("/admin");
}

export async function adminRestartSupervisorAction() {
  await requireAdmin();
  await q.requestSupervisorRestart();
  revalidatePath("/admin");
}
