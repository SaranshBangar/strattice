// USD -> display-currency conversion for chart prices (Binance quotes in USDT).
// open.er-api.com is free and keyless; rates update daily, which is plenty for
// display-only conversion. Cached 12h via Next's fetch cache.
export async function usdRate(code: string): Promise<number | null> {
  if (code === "USD") return 1;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 43200 },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const rate = Number(j?.rates?.[code]);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
