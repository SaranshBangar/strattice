// Shared coin catalog: the tradeable markets offered across the app (strategy
// picker, charts, DCA, comparisons) plus display metadata for each coin - name,
// brand colour and a logo glyph - so every dropdown and graph identifies a coin
// the same way. Market ids follow the CoinDCX INR convention (I-BTC_INR); the
// candles proxy maps any of these to a Binance USDT symbol for chart data.
export interface Coin {
  /** CoinDCX-style market id, e.g. "I-BTC_INR". */
  market: string;
  /** Ticker, e.g. "BTC". */
  symbol: string;
  /** Full name, e.g. "Bitcoin". */
  name: string;
  /** Brand colour for the logo disc. */
  color: string;
  /** Glyph text colour on the disc (some brand colours need dark text). */
  ink: string;
  /** One-character logo glyph drawn on the disc. */
  glyph: string;
}

export const COINS: Coin[] = [
  { market: "I-BTC_INR", symbol: "BTC", name: "Bitcoin", color: "#F7931A", ink: "#FFFFFF", glyph: "₿" },
  { market: "I-ETH_INR", symbol: "ETH", name: "Ethereum", color: "#627EEA", ink: "#FFFFFF", glyph: "Ξ" },
  { market: "I-SOL_INR", symbol: "SOL", name: "Solana", color: "#9945FF", ink: "#FFFFFF", glyph: "◎" },
  { market: "I-XRP_INR", symbol: "XRP", name: "XRP", color: "#0080C7", ink: "#FFFFFF", glyph: "✕" },
  { market: "I-BNB_INR", symbol: "BNB", name: "BNB", color: "#F3BA2F", ink: "#1E2026", glyph: "◆" },
  { market: "I-DOGE_INR", symbol: "DOGE", name: "Dogecoin", color: "#C2A633", ink: "#FFFFFF", glyph: "Ð" },
  { market: "I-ADA_INR", symbol: "ADA", name: "Cardano", color: "#0D5BD5", ink: "#FFFFFF", glyph: "₳" },
  { market: "I-AVAX_INR", symbol: "AVAX", name: "Avalanche", color: "#E84142", ink: "#FFFFFF", glyph: "▲" },
  { market: "I-LINK_INR", symbol: "LINK", name: "Chainlink", color: "#2A5ADA", ink: "#FFFFFF", glyph: "⬡" },
  { market: "I-DOT_INR", symbol: "DOT", name: "Polkadot", color: "#E6007A", ink: "#FFFFFF", glyph: "●" },
  { market: "I-LTC_INR", symbol: "LTC", name: "Litecoin", color: "#345D9D", ink: "#FFFFFF", glyph: "Ł" },
  { market: "I-POL_INR", symbol: "POL", name: "Polygon", color: "#8247E5", ink: "#FFFFFF", glyph: "⬢" },
  { market: "I-TRX_INR", symbol: "TRX", name: "Tron", color: "#EF0027", ink: "#FFFFFF", glyph: "T" },
  { market: "I-SHIB_INR", symbol: "SHIB", name: "Shiba Inu", color: "#FFA409", ink: "#1E2026", glyph: "S" },
];

/** Preset market ids offered in pickers, in catalog order. */
export const MARKETS = COINS.map((c) => c.market);

const BY_SYMBOL = new Map(COINS.map((c) => [c.symbol, c]));

/** Base ticker of any supported market-id shape (I-BTC_INR, B-BTC_USDT, BTCUSDT, BTC). */
export function baseSymbol(market: string): string {
  const m = /^(?:[A-Z]-)?([A-Z0-9]{2,12}?)(?:_?(?:INR|USDT))?$/.exec(
    (market ?? "").toUpperCase().trim(),
  );
  return m ? m[1] : (market ?? "").toUpperCase();
}

/** Catalog entry for a market id (or bare ticker), if the coin is known. */
export function coinFor(market: string): Coin | undefined {
  return BY_SYMBOL.get(baseSymbol(market));
}

/** Human label for a market id: "I-BTC_INR" -> "BTC/INR". */
export function marketLabel(market: string): string {
  return market.replace(/^I-/, "").replace("_", "/");
}
