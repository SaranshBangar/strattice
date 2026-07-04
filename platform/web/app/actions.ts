"use server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getUser, requireUserId, requireAdmin } from "@/lib/session";
import * as q from "@/lib/queries";
import { createSubscription, cancelSubscription, cashfreeMode } from "@/lib/cashfree";
import { PAID_TIERS, TIERS, type TierName } from "@/lib/entitlements";
import { sendApiKeyEmail } from "@/lib/email";

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
  await q.addStrategy(userId, String(formData.get("template")), String(formData.get("market")));
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
