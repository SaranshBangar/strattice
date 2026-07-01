import { NextResponse } from "next/server";

// Server-side proxy to the bot's /api/signals endpoint (buy/sell-filtered, uncapped
// by the 30-row /api/status payload). Keeps BOT_API_TOKEN out of the browser.
export const revalidate = 0;

export async function GET(req: Request) {
  const action = new URL(req.url).searchParams.get("action");
  if (action !== "buy" && action !== "sell") {
    return NextResponse.json({ error: "action must be 'buy' or 'sell'" }, { status: 400 });
  }
  const base = process.env.BOT_API_URL;
  const token = process.env.BOT_API_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: "BOT_API_URL/TOKEN not set" }, { status: 500 });
  }
  try {
    const r = await fetch(`${base}/api/signals?action=${action}`, {
      headers: { "X-Token": token },
      next: { revalidate: 10 },
    });
    if (!r.ok) {
      return NextResponse.json({ error: `bot ${r.status}` }, { status: 502 });
    }
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
