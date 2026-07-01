// Trade notifications. The Python supervisor POSTs here after it records a buy/sell
// fill (trades live in D1, written by the bot — this app only reads them), so a
// trade email needs a push from that side. Guarded by a shared secret.
import { NextResponse } from "next/server";
import * as q from "@/lib/queries";
import { sendTradeEmail } from "@/lib/email";

export const runtime = "nodejs"; // node:tls SMTP
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || req.headers.get("x-internal-key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const userId = String(b.userId || "");
  const side = String(b.side || "");
  const market = String(b.market || "");
  if (!userId || (side !== "buy" && side !== "sell") || !market) {
    return NextResponse.json({ error: "need userId, side (buy|sell), market" }, { status: 400 });
  }

  const user = await q.getUserContact(userId);
  if (!user) return NextResponse.json({ ok: true, ignored: "unknown user" });

  await sendTradeEmail(user.email, {
    side,
    market,
    qty: Number(b.qty) || 0,
    price: Number(b.price) || 0,
    notional: Number(b.notional) || 0,
    strategy: b.strategy ? String(b.strategy) : undefined,
    dryRun: Boolean(b.dryRun),
  });
  return NextResponse.json({ ok: true });
}
