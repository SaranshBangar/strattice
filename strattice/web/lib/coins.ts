// Shared coin catalog: the tradeable markets offered across the app (strategy
// picker, charts, DCA, comparisons) plus display metadata for each coin - name,
// brand colour and logo - so every dropdown and graph identifies a coin the
// same way. Market ids follow the CoinDCX INR convention (I-BTC_INR); the
// candles proxy maps any of these to a Binance USDT symbol for chart data.
//
// Logos come from CoinCap's free public icon set (no key, no rate limit,
// uniform ticker-keyed URLs); the brand-coloured glyph disc is the offline /
// unknown-coin fallback the CoinLogo component swaps in if an image fails.
export interface Coin {
  /** CoinDCX-style market id, e.g. "I-BTC_INR". */
  market: string;
  /** Ticker, e.g. "BTC". */
  symbol: string;
  /** Full name, e.g. "Bitcoin". */
  name: string;
  /** Brand colour for the fallback logo disc. */
  color: string;
  /** Glyph text colour on the disc (some brand colours need dark text). */
  ink: string;
  /** One-character fallback glyph drawn on the disc. */
  glyph: string;
  /** Icon-set key when it differs from the ticker (e.g. POL under its old MATIC key). */
  iconKey?: string;
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
  { market: "I-POL_INR", symbol: "POL", name: "Polygon", color: "#8247E5", ink: "#FFFFFF", glyph: "⬢", iconKey: "matic" },
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

/** Public, keyless logo URL for a known coin (CoinCap's free icon CDN). */
export function coinLogoUrl(coin: Coin): string {
  return `https://assets.coincap.io/assets/icons/${(coin.iconKey ?? coin.symbol).toLowerCase()}@2x.png`;
}
