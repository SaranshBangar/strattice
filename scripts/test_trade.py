"""Manual buy/sell smoke test. Hits the LIVE exchange API directly via the client —
does NOT go through the bot/executor, so DRY_RUN is NOT honored here. Real money.

Usage:
    python -m scripts.test_trade --asset BTC --quote 200 --side buy        # CoinDCX: ₹200
    python -m scripts.test_trade --asset ETH --quote 200 --side sell
    python -m scripts.test_trade --asset BTC --quote 200 --side both       # buy then sell same qty
    python -m scripts.test_trade --exchange binance --asset BTC --quote 10 --side both  # $10

--exchange = coindcx (INR pairs) | binance (USDT pairs); default: config/EXCHANGE env.
--quote    = order value in the venue's quote currency (INR or USDT), converted to base
             qty at the latest 1-minute close. --inr is kept as an alias.
--qty      = base-asset quantity directly (overrides --quote).
"""
import argparse
import sys

from bot import config
from bot.client import ExchangeError, make_client

ASSETS = ("BTC", "ETH")


def pair_for(exchange: str, asset: str) -> str:
    return f"B-{asset}_USDT" if exchange == "binance" else f"I-{asset}_INR"


def place(c, pair: str, side: str, qty: float):
    print(f"  -> {side.upper()} {qty} {pair} (market)")
    res = c.create_order(market=pair, side=side, qty=qty)
    print(f"     resp: {res}")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exchange", choices=["coindcx", "binance"], default=None)
    ap.add_argument("--asset", choices=ASSETS, required=True)
    ap.add_argument("--side", choices=["buy", "sell", "both"], required=True)
    ap.add_argument("--quote", "--inr", dest="quote", type=float,
                    help="order value in the quote currency (INR or USDT)")
    ap.add_argument("--qty", type=float, help="base-asset qty (overrides --quote)")
    a = ap.parse_args()

    if a.qty is None and a.quote is None:
        ap.error("set --quote or --qty")

    ex = a.exchange or config.exchange()
    pair = pair_for(ex, a.asset)
    c = make_client(ex)

    if a.qty is not None:
        qty = a.qty
    else:
        bars = c.candles(pair, "1m", limit=2)
        if not bars:
            raise SystemExit(f"no recent price for {pair}")
        px = float(bars[-1]["close"])
        qty = a.quote / px
        print(f"price {pair} = {px}, {a.quote} -> {qty} {a.asset}")

    qty = c.round_qty(pair, qty)
    mn = c.min_quantity(pair)
    if qty < mn:
        raise SystemExit(f"qty {qty} below min_quantity {mn} for {pair}")

    print(f"\n*** LIVE ORDER on {ex} {pair}, qty={qty}, side={a.side} ***")
    if input("type YES to send: ").strip() != "YES":
        sys.exit("aborted")

    try:
        if a.side in ("buy", "both"):
            place(c, pair, "buy", qty)
        if a.side in ("sell", "both"):
            place(c, pair, "sell", qty)
    except ExchangeError as e:
        raise SystemExit(f"order failed: {e}")

    print("done")


if __name__ == "__main__":
    main()
