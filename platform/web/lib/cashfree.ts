// Cashfree Subscriptions (recurring) REST client + webhook verification. Raw fetch (no SDK dep).
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/subscription/overview
// Plans are created INLINE in the subscription (plan_details) - no separate plan registry.
import { createHmac, timingSafeEqual } from "crypto";
import { resolveTier, type TierName } from "./entitlements";

const MODE = process.env.CASHFREE_MODE === "production" ? "production" : "sandbox";
const BASE = MODE === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const API_VERSION = process.env.CASHFREE_API_VERSION || "2025-01-01";

function headers() {
  const id = process.env.CASHFREE_APP_ID,
    secret = process.env.CASHFREE_SECRET_KEY;
  if (!id || !secret) throw new Error("set CASHFREE_APP_ID, CASHFREE_SECRET_KEY");
  return { "Content-Type": "application/json", "x-api-version": API_VERSION, "x-client-id": id, "x-client-secret": secret };
}

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`cashfree ${path} ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

export interface CreateSubArgs {
  subscriptionId: string;
  tier: Exclude<TierName, "free">;
  customer: { name: string; email: string; phone: string };
  returnUrl: string;
}

export async function createSubscription(a: CreateSubArgs) {
  const t = resolveTier(a.tier);
  const res = await call("POST", "/subscriptions", {
    subscription_id: a.subscriptionId,
    customer_details: {
      customer_name: a.customer.name,
      customer_email: a.customer.email,
      customer_phone: a.customer.phone,
    },
    plan_details: {
      plan_name: `Strattice ${t.name}`,
      plan_type: "PERIODIC",
      plan_amount: t.priceInr,
      plan_max_amount: t.priceInr,
      plan_max_cycles: 120, // 10 years; renews monthly until cancelled
      plan_intervals: 1,
      plan_interval_type: "MONTH",
      plan_currency: "INR",
    },
    authorization_details: { authorization_amount: 1, authorization_amount_refund: true },
    subscription_meta: { return_url: a.returnUrl },
    subscription_note: t.name,
  });
  // response carries subscription_id + subscription_session_id for the JS checkout
  return res as { subscription_id: string; subscription_session_id: string; subscription_status: string };
}

export async function getSubscription(id: string) {
  return call("GET", `/subscriptions/${id}`);
}

export async function cancelSubscription(id: string) {
  return call("POST", `/subscriptions/${id}/manage`, { action: "CANCEL" });
}

/** Verify a Cashfree webhook. Signature = base64(HMAC_SHA256(timestamp + rawBody, secret)). */
export function verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
  const a = Buffer.from(expected),
    b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const cashfreeMode = MODE;
