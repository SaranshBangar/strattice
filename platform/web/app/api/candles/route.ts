// Proxy for CoinDCX public candles. Keeps the browser off cross-origin CoinDCX and
// caches upstream for 15s so many pollers cost one fetch. No auth needed (public data).
import { NextResponse } from "next/server";

const INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d", "1w"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pair = (searchParams.get("pair") || "I-BTC_INR").toUpperCase();
  const interval = searchParams.get("interval") || "15m";
  const limit = Math.min(500, Math.max(10, Number(searchParams.get("limit")) || 200));

  if (!/^[A-Z0-9_-]{3,24}$/.test(pair)) return NextResponse.json({ error: "invalid pair" }, { status: 400 });
  if (!INTERVALS.has(interval)) return NextResponse.json({ error: "invalid interval" }, { status: 400 });

  try {
    const url = `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
    const r = await fetch(url, { next: { revalidate: 15 }, headers: { accept: "application/json" } });
    if (!r.ok) return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    const data = await r.json();
    // CoinDCX returns newest-first {open,high,low,close,volume,time(ms)}; hand back oldest-first, compact.
    const candles = (Array.isArray(data) ? data : [])
      .reverse()
      .map((c: { time: number; open: number; high: number; low: number; close: number; volume: number }) => ({
        t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
      }));
    return NextResponse.json({ pair, interval, candles });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
