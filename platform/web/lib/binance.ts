// Shared Binance symbol mapping. Legacy CoinDCX pair names (I-BTC_INR,
// B-ETH_USDT) still flow through the app; charts and the candles proxy map
// them to Binance USDT symbols here.
export function toBinanceSymbol(pair: string): string | null {
  const m = /^(?:[A-Z]-)?([A-Z0-9]{2,12})(?:_(?:INR|USDT))?$/.exec(
    pair.toUpperCase(),
  );
  if (!m) return null;
  const base = m[1];
  return base.endsWith("USDT") ? base : `${base}USDT`;
}
