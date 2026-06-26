"""Manual buy/sell smoke test. Hits the LIVE CoinDCX API directly via Client —
does NOT go through the bot/executor, so DRY_RUN is NOT honored here. Real money.

Usage:
    python scripts/test_trade.py --asset BTC --inr 200 --side buy
    python scripts/test_trade.py --asset ETH --inr 200 --side sell
    python scripts/test_trade.py --asset BTC --inr 200 --side both   # buy then sell same qty

--inr  = order value in INR (converted to base qty at the live ticker price).
--qty  = base-asset quantity directly (overrides --inr).
"""
import argparse
import sys

import requests

from bot.client import Client, CoinDCXError

PAIRS = {"BTC": "I-BTC_INR", "ETH": "I-ETH_INR"}
TICKERS = {"BTC": "BTCINR", "ETH": "ETHINR"}


def last_price(asset: str) -> float:
    r = requests.get("https://api.coindcx.com/exchange/ticker", timeout=10)
    r.raise_for_status()
    for t in r.json():
        if t.get("market") == TICKERS[asset]:
            return float(t["last_price"])
    raise SystemExit(f"no ticker for {TICKERS[asset]}")


def place(c: Client, pair: str, side: str, qty: float):
    print(f"  -> {side.upper()} {qty} {pair} (market)")
    res = c.create_order(market=pair, side=side, qty=qty)
    print(f"     resp: {res}")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", choices=PAIRS, required=True)
    ap.add_argument("--side", choices=["buy", "sell", "both"], required=True)
    ap.add_argument("--inr", type=float, help="order value in INR")
    ap.add_argument("--qty", type=float, help="base-asset qty (overrides --inr)")
    a = ap.parse_args()

    if a.qty is None and a.inr is None:
        ap.error("set --inr or --qty")

    pair = PAIRS[a.asset]
    c = Client()

    if a.qty is not None:
        qty = a.qty
    else:
        px = last_price(a.asset)
        qty = a.inr / px
        print(f"price {a.asset}INR = {px}, {a.inr} INR -> {qty} {a.asset}")

    qty = c.round_qty(pair, qty)
    mn = c.min_quantity(pair)
    if qty < mn:
        raise SystemExit(f"qty {qty} below min_quantity {mn} for {pair}")

    print(f"\n*** LIVE ORDER on {pair}, qty={qty}, side={a.side} ***")
    if input("type YES to send: ").strip() != "YES":
        sys.exit("aborted")

    try:
        if a.side in ("buy", "both"):
            place(c, pair, "buy", qty)
        if a.side in ("sell", "both"):
            place(c, pair, "sell", qty)
    except CoinDCXError as e:
        raise SystemExit(f"order failed: {e}")

    print("done")


if __name__ == "__main__":
    main()
