import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/cashfree";
import * as q from "@/lib/queries";

export const runtime = "nodejs"; // needs node crypto + raw body
export const dynamic = "force-dynamic";

const MONTH = 30 * 24 * 60 * 60;

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-webhook-signature") ?? "";
  const ts = req.headers.get("x-webhook-timestamp") ?? "";
  if (!verifyWebhook(raw, sig, ts)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type: string = body.type ?? body.event ?? "UNKNOWN";
  const subId: string | undefined =
    body?.data?.subscription_details?.subscription_id ?? body?.data?.subscription_id;
  if (!subId) return NextResponse.json({ ok: true, ignored: "no subscription_id" });

  // Idempotency: Cashfree retries. Key on type+sub+timestamp.
  const userId = await q.userIdByCashfreeSub(subId);
  const fresh = await q.recordBillingEvent(`${type}:${subId}:${ts}`, userId, type, raw);
  if (!fresh) return NextResponse.json({ ok: true, duplicate: true });

  const T = type.toUpperCase();
  if (T.includes("PAYMENT") && T.includes("SUCCESS")) {
    await q.setSubscriptionStatus(subId, "active", Math.floor(Date.now() / 1000) + MONTH);
  } else if (T.includes("PAYMENT") && (T.includes("FAIL") || T.includes("DECLINE"))) {
    await q.setSubscriptionStatus(subId, "past_due"); // keep period_end -> grace until it lapses
  } else if (T.includes("CANCEL")) {
    await q.setSubscriptionStatus(subId, "cancelled");
  } else if (T.includes("EXPIR")) {
    await q.setSubscriptionStatus(subId, "expired", null);
  }
  // other lifecycle events (authorized/created) recorded but need no state change.

  return NextResponse.json({ ok: true });
}
