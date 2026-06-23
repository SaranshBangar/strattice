"""Shared regime gate (item 3). Long entries fire only when the market is in an uptrend.

Cutting entries in chop is the main lever against TDS: fewer trades -> less 1% sell tax.
Two configurable rules:
  "ma"        -> price above its `period`-bar simple MA (default, period 200)
  "ema_slope" -> `period`-bar EMA rising vs the prior bar
Both need `period`+1 bars of history; with too little history we return False (stay flat).
"""
from .base import ema, sma


def uptrend(candles: list[dict], period: int = 200, rule: str = "ma") -> bool:
    closes = [c["close"] for c in candles]
    if len(closes) < period + 1:
        return False
    if rule == "ema_slope":
        now, prev = ema(closes, period), ema(closes[:-1], period)
        return now is not None and prev is not None and now > prev
    ma = sma(closes, period)
    return ma is not None and closes[-1] > ma
