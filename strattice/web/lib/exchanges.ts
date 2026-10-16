// Supported exchanges. A user links ONE exchange's API keys; the supervisor then runs
// their bot on that venue (worker/config_gen.py EXCHANGE_PROFILE is the server-side
// twin of this table). Market ids keep one spelling everywhere: I-BTC_INR is a CoinDCX
// INR pair, B-BTC_USDT a USDT pair (BTCUSDT on Binance).
import { COINS } from "./coins";

export const EXCHANGES = ["coindcx", "binance"] as const;
export type Exchange = (typeof EXCHANGES)[number];
export const DEFAULT_EXCHANGE: Exchange = "coindcx";

export interface ExchangeMeta {
  label: string;
  /** Currency the bot's book is kept in on this venue. */
  quote: "INR" | "USDT";
  quoteSymbol: string;
  /** Where users create API keys. */
  keysUrl: string;
  /** Exact permissions to grant - shown next to the key form. */
  keyHelp: string;
  /** Round-trip friction summary, shown where costs are explained. */
  costNote: string;
  /** Round-trip friction (fees + GST + TDS, % of notional) the browser simulations
   *  charge per closed trade. Mirrors worker/config_gen.py EXCHANGE_PROFILE costs. */
  frictionPct: number;
}

export const EXCHANGE_META: Record<Exchange, ExchangeMeta> = {
  coindcx: {
    label: "CoinDCX",
    quote: "INR",
    quoteSymbol: "₹",
    keysUrl: "https://coindcx.com/api-dashboard",
    keyHelp:
      "Create a key in CoinDCX → API Dashboard with trading enabled. Never enable withdrawals.",
    costNote:
      "~1.5% per round trip: 0.2% fee + 18% GST each side, plus 1% TDS on every sell.",
    frictionPct: 1.47,
  },
  binance: {
    label: "Binance",
    quote: "USDT",
    quoteSymbol: "$",
    keysUrl: "https://www.binance.com/en/my/settings/api-management",
    keyHelp:
      "Create a key in Binance → API Management with “Enable Spot & Margin Trading” only. Never enable withdrawals; restricting it to a trusted IP is safest.",
    costNote:
      "~0.24% per round trip: 0.1% fee + 18% GST each side (no TDS withheld on spot trades - you still owe VDA tax).",
    frictionPct: 0.24,
  },
};

export function isExchange(x: unknown): x is Exchange {
  return typeof x === "string" && (EXCHANGES as readonly string[]).includes(x);
}

export function exchangeOf(x: unknown): Exchange {
  return isExchange(x) ? x : DEFAULT_EXCHANGE;
}

/** A market id expressed on an exchange. Binance has no INR book, so an INR pair maps
 *  to its USDT twin (I-BTC_INR -> B-BTC_USDT); CoinDCX lists both kinds, so ids pass.
 *  Mirrors worker/config_gen.py market_for(). */
export function marketFor(exchange: Exchange, market: string): string {
  const m = /^I-([A-Z0-9]+)_INR$/.exec(market);
  return exchange === "binance" && m ? `B-${m[1]}_USDT` : market;
}

/** The preset coin markets offered in pickers, spelled for the exchange. */
export function marketsFor(exchange: Exchange): string[] {
  return COINS.map((c) => marketFor(exchange, c.market));
}
