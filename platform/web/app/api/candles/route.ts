// Proxy for Binance public klines (free, no key, faster + deeper history than
// CoinDCX). Accepts legacy CoinDCX pair names (I-BTC_INR / B-BTC_USDT) and maps
// them to Binance USDT symbols, so existing callers keep working unchanged.
// Caches upstream for 5s so many pollers cost one fetch. Display/analysis only;
// order execution still happens on CoinDCX.
import { NextResponse } from "next/server";
import { toBinanceSymbol } from "@/lib/binance";

const INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "1d",
  "1w",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pair = (searchParams.get("pair") || "I-BTC_INR").toUpperCase();
  const interval = searchParams.get("interval") || "15m";
  const limit = Math.min(
    1000,
    Math.max(10, Number(searchParams.get("limit")) || 200),
  );

  if (!/^[A-Z0-9_-]{3,24}$/.test(pair))
    return NextResponse.json({ error: "invalid pair" }, { status: 400 });
  const symbol = toBinanceSymbol(pair);
  if (!symbol)
    return NextResponse.json({ error: "invalid pair" }, { status: 400 });
  if (!INTERVALS.has(interval))
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await fetch(url, {
      next: { revalidate: 5 },
      headers: { accept: "application/json" },
    });
    if (!r.ok)
      return NextResponse.json(
        { error: `upstream ${r.status}` },
        { status: 502 },
      );
    const data = await r.json();
    // Binance klines: oldest-first arrays [openTime, open, high, low, close, volume, ...]
    const candles = (Array.isArray(data) ? data : []).map(
      (k: (string | number)[]) => ({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
      }),
    );
    return NextResponse.json({ pair, symbol, interval, candles });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
