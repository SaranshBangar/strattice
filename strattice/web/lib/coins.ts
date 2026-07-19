// Shared coin catalog: the tradeable markets offered across the app (strategy
// picker, charts, DCA, comparisons) plus display metadata for each coin - name,
// brand colour and logo - so every dropdown and graph identifies a coin the
// same way. Market ids follow the CoinDCX INR convention (I-BTC_INR); the
// candles proxy maps any of these to a Binance USDT symbol for chart data.
//
// Logos come from free public icon sets, but the app's CSP allows images from
// 'self' only - so the browser loads them through the same-origin proxy at
// /api/coin-logo (coinLogoUrl), which fetches from the upstream mirrors listed
// in coinLogoSources with caching. The brand-coloured glyph disc is the
// fallback the CoinLogo component swaps in if every source fails.
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
  /** CoinGecko-hosted image (last-resort mirror; paths are irregular per coin). */
  gecko?: string;
}

const GECKO = "https://assets.coingecko.com/coins/images";

export const COINS: Coin[] = [
  { market: "I-BTC_INR", symbol: "BTC", name: "Bitcoin", color: "#F7931A", ink: "#FFFFFF", glyph: "₿", gecko: `${GECKO}/1/small/bitcoin.png` },
  { market: "I-ETH_INR", symbol: "ETH", name: "Ethereum", color: "#627EEA", ink: "#FFFFFF", glyph: "Ξ", gecko: `${GECKO}/279/small/ethereum.png` },
  { market: "I-SOL_INR", symbol: "SOL", name: "Solana", color: "#9945FF", ink: "#FFFFFF", glyph: "◎", gecko: `${GECKO}/4128/small/solana.png` },
  { market: "I-XRP_INR", symbol: "XRP", name: "XRP", color: "#0080C7", ink: "#FFFFFF", glyph: "✕", gecko: `${GECKO}/44/small/xrp-symbol-white-128.png` },
  { market: "I-BNB_INR", symbol: "BNB", name: "BNB", color: "#F3BA2F", ink: "#1E2026", glyph: "◆", gecko: `${GECKO}/825/small/bnb-icon2_2x.png` },
  { market: "I-DOGE_INR", symbol: "DOGE", name: "Dogecoin", color: "#C2A633", ink: "#FFFFFF", glyph: "Ð", gecko: `${GECKO}/5/small/dogecoin.png` },
  { market: "I-ADA_INR", symbol: "ADA", name: "Cardano", color: "#0D5BD5", ink: "#FFFFFF", glyph: "₳", gecko: `${GECKO}/975/small/cardano.png` },
  { market: "I-AVAX_INR", symbol: "AVAX", name: "Avalanche", color: "#E84142", ink: "#FFFFFF", glyph: "▲", gecko: `${GECKO}/12559/small/Avalanche_Circle_RedWhite_Trans.png` },
  { market: "I-LINK_INR", symbol: "LINK", name: "Chainlink", color: "#2A5ADA", ink: "#FFFFFF", glyph: "⬡", gecko: `${GECKO}/877/small/chainlink-new-logo.png` },
  { market: "I-DOT_INR", symbol: "DOT", name: "Polkadot", color: "#E6007A", ink: "#FFFFFF", glyph: "●", gecko: `${GECKO}/12171/small/polkadot.png` },
  { market: "I-LTC_INR", symbol: "LTC", name: "Litecoin", color: "#345D9D", ink: "#FFFFFF", glyph: "Ł", gecko: `${GECKO}/2/small/litecoin.png` },
  { market: "I-POL_INR", symbol: "POL", name: "Polygon", color: "#8247E5", ink: "#FFFFFF", glyph: "⬢", iconKey: "matic", gecko: `${GECKO}/4713/small/matic-token-icon.png` },
  { market: "I-TRX_INR", symbol: "TRX", name: "Tron", color: "#EF0027", ink: "#FFFFFF", glyph: "T", gecko: `${GECKO}/1094/small/tron-logo.png` },
  { market: "I-SHIB_INR", symbol: "SHIB", name: "Shiba Inu", color: "#FFA409", ink: "#1E2026", glyph: "S", gecko: `${GECKO}/11939/small/shiba.png` },
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

/** Same-origin logo URL for a known coin. The CSP only allows images from
 *  'self', so the browser must go through the /api/coin-logo proxy - never
 *  point an <img> at the upstream hosts directly. */
export function coinLogoUrl(coin: Coin): string {
  return `/api/coin-logo?symbol=${encodeURIComponent(coin.symbol)}`;
}

/** Ordered upstream mirrors for a coin's logo - free, keyless public icon
 *  sets, tried in order by the /api/coin-logo proxy (server-side, so the
 *  browser CSP does not apply). Any dead mirror just falls through. */
export function coinLogoSources(coin: Coin): string[] {
  const key = (coin.iconKey ?? coin.symbol).toLowerCase();
  return [
    // spothq/cryptocurrency-icons via jsDelivr: the standard open-source set.
    `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${key}.png`,
    // CoinCap's asset icons: uniform ticker-keyed URLs, broad coverage.
    `https://assets.coincap.io/assets/icons/${key}@2x.png`,
    // CoinGecko-hosted image as the last resort (irregular per-coin paths).
    ...(coin.gecko ? [coin.gecko] : []),
  ];
}
