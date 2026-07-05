import { NextResponse } from "next/server";

// Proxy Binance public klines (free, no key, faster than CoinDCX) but keep the
// CoinDCX response shape so existing callers work unchanged.
// Accepts legacy pair names: I-BTC_INR -> BTCUSDT.
// GET /api/candles?pair=I-BTC_INR&interval=15m&limit=200
function toBinanceSymbol(pair: string): string | null {
  const m = /^(?:[A-Z]-)?([A-Z0-9]{2,12})(?:_(?:INR|USDT))?$/.exec(
    pair.toUpperCase(),
  );
  if (!m) return null;
  return m[1].endsWith("USDT") ? m[1] : `${m[1]}USDT`;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const pair = u.searchParams.get("pair") ?? "I-BTC_INR";
  const interval = u.searchParams.get("interval") ?? "15m";
  const limit = Math.min(1000, Math.max(1, Number(u.searchParams.get("limit")) || 200));
  const symbol = toBinanceSymbol(pair);
  if (!symbol)
    return NextResponse.json({ error: "invalid pair" }, { status: 400 });
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const r = await fetch(url, { next: { revalidate: 5 } });
    if (!r.ok)
      return NextResponse.json(
        { error: `binance ${r.status}` },
        { status: 502 },
      );
    const data = await r.json();
    // Binance klines are oldest-first arrays; reshape to CoinDCX candle objects.
    const candles = (Array.isArray(data) ? data : []).map(
      (k: (string | number)[]) => ({
        time: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      }),
    );
    return NextResponse.json(candles);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
