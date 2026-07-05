// Trade notifications. The Python supervisor POSTs here after it records a buy/sell
// fill (trades live in D1, written by the bot — this app only reads them), so a
// trade notification needs a push from that side. Guarded by a shared secret.
//
// Fans a fill out to the channels the user has enabled: email (default on) and/or
// Telegram (opt-in with a saved chat id). The single-user bot path (email sent directly,
// no userId) has no stored prefs, so it always emails, as before.
import { NextResponse } from "next/server";
import * as q from "@/lib/queries";
import { sendTradeEmail } from "@/lib/email";
import { sendTradeTelegram } from "@/lib/telegram";

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
  if ((!userId && !b.email) || (side !== "buy" && side !== "sell") || !market) {
    return NextResponse.json({ error: "need userId or email, side (buy|sell), market" }, { status: 400 });
  }

  const trade = {
    side,
    market,
    qty: Number(b.qty) || 0,
    price: Number(b.price) || 0,
    notional: Number(b.notional) || 0,
    strategy: b.strategy ? String(b.strategy) : undefined,
    dryRun: Boolean(b.dryRun),
  };

  // Direct-email path (single-user bot): no prefs to consult, just send.
  if (!userId && b.email) {
    await sendTradeEmail(String(b.email), trade);
    return NextResponse.json({ ok: true, email: true });
  }

  // Multi-user path: look up the user's contact + channel preferences in one query.
  const target = await q.getNotifyTarget(userId);
  if (!target) return NextResponse.json({ ok: true, ignored: "unknown user" });

  const sent = { email: false, telegram: false };
  const jobs: Promise<unknown>[] = [];
  if (target.email_enabled && target.email) {
    sent.email = true;
    jobs.push(sendTradeEmail(target.email, trade));
  }
  if (target.telegram_enabled && target.telegram_chat_id) {
    sent.telegram = true;
    jobs.push(sendTradeTelegram(target.telegram_chat_id, trade));
  }
  await Promise.all(jobs);
  return NextResponse.json({ ok: true, ...sent });
}
