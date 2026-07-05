"use server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getUser, requireUserId, requireAdmin } from "@/lib/session";
import * as q from "@/lib/queries";
import { createSubscription, cancelSubscription, cashfreeMode } from "@/lib/cashfree";
import { PAID_TIERS, TIERS, BUILTIN_TEMPLATES, type TierName, type BuiltinTemplate } from "@/lib/entitlements";
import { sanitizeParams } from "@/lib/strategy-sim";
import { sanitizeCustomDef } from "@/lib/custom-strategy";
import { sendApiKeyEmail } from "@/lib/email";
import { sendTelegram, telegramConfigured, table } from "@/lib/telegram";

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

export async function addStrategyAction(formData: FormData) {
  const userId = await requireUserId();
  const template = String(formData.get("template"));
  const market = String(formData.get("market") || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(market)) throw new Error("Enter a valid market id, e.g. I-BTC_INR");

  // params are user input: re-validate server-side regardless of what the UI enforced.
  const raw = formData.get("params");
  let paramsJson: string | null = null;
  if (template === "custom") {
    paramsJson = JSON.stringify(sanitizeCustomDef(String(raw ?? "")));
  } else if (raw) {
    if (!(BUILTIN_TEMPLATES as readonly string[]).includes(template)) throw new Error("unknown template");
    let parsed: unknown;
    try { parsed = JSON.parse(String(raw)); } catch { throw new Error("Invalid strategy parameters."); }
    const clean = sanitizeParams(template as BuiltinTemplate, parsed);
    paramsJson = clean ? JSON.stringify(clean) : null;
  }

  await q.addStrategy(userId, template, market, paramsJson);
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

export async function setBotAction(patch: { active?: boolean; live?: boolean }) {
  const userId = await requireUserId();
  await q.setBotState(userId, patch);
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
  revalidatePath("/account");
}

/** Save (and enable) a Telegram chat id. Sends a confirmation message so the user gets
 *  immediate proof the id + bot chat are wired up; a failed send is reported, not fatal. */
export async function saveTelegramNotificationsAction(chatId: string):
  Promise<{ ok: true; test: "sent" | "failed" | "unconfigured" }> {
  const userId = await requireUserId();
  const id = chatId.trim();
  if (!/^-?\d{5,20}$/.test(id)) {
    throw new Error("Enter the numeric chat id from @userinfobot (digits only).");
  }
  await q.setNotificationPrefs(userId, { telegramEnabled: true, telegramChatId: id });
  const res = await sendTelegram(
    id,
    table("Strattice connected", [["Alerts", "on"], ["You'll get", "buy / sell fills"]]),
  );
  const test = res.ok ? "sent" : res.reason === "unconfigured" ? "unconfigured" : "failed";
  revalidatePath("/account");
  return { ok: true, test };
}

export async function removeTelegramNotificationsAction() {
  const userId = await requireUserId();
  await q.setNotificationPrefs(userId, { telegramEnabled: false, telegramChatId: null });
  revalidatePath("/account");
}

// ---------- billing (Cashfree) ----------
// Pricing is disabled for now (the platform is fully free); checkout is kept behind this
// guard so the plumbing survives for when plans return, but nothing can start a mandate.
const PRICING_ENABLED = false;

export async function startSubscriptionAction(tier: string, phone: string) {
  if (!PRICING_ENABLED) throw new Error("Strattice is free right now - there is nothing to subscribe to.");
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
