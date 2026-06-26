import { NextResponse } from "next/server";

// Proxy CoinDCX public candles (no auth) to dodge CORS + add a short cache.
// GET /api/candles?pair=I-BTC_INR&interval=15m&limit=200
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pair = u.searchParams.get("pair") ?? "I-BTC_INR";
  const interval = u.searchParams.get("interval") ?? "15m";
  const limit = u.searchParams.get("limit") ?? "200";
  const url = `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(
    pair
  )}&interval=${interval}&limit=${limit}`;
  try {
    const r = await fetch(url, { next: { revalidate: 30 } });
    if (!r.ok) return NextResponse.json({ error: `coindcx ${r.status}` }, { status: 502 });
    return NextResponse.json(await r.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
