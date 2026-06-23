"""Strategy base + indicator helpers. Strategies are PURE: candles in -> BUY/SELL/HOLD out.
No I/O, no order placement, no position state. The engine owns side effects.

Candle = {"open","high","low","close","volume","time"} (ms), oldest-first.
"""
from __future__ import annotations


def sma(values: list[float], n: int) -> float | None:
    return sum(values[-n:]) / n if len(values) >= n else None


def atr(candles: list[dict], n: int) -> float | None:
    """Average True Range over the last n bars (Wilder's TR, simple mean)."""
    if len(candles) < n + 1:
        return None
    trs = []
    for i in range(-n, 0):
        h, l, pc = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / n


def avg_volume(candles: list[dict], n: int) -> float | None:
    if len(candles) < n:
        return None
    return sum(c["volume"] for c in candles[-n:]) / n


def rsi(closes: list[float], n: int) -> float | None:
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for i in range(-n, 0):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    if losses == 0:
        return 100.0
    rs = (gains / n) / (losses / n)
    return 100.0 - 100.0 / (1.0 + rs)


class Strategy:
    min_candles = 2  # guard: engine skips until enough history

    def __init__(self, name: str, market: str, params: dict):
        self.name = name
        self.market = market
        self.params = params
        # Shared regime gate (item 3): long entries only fire in an uptrend.
        self.regime_period = int(params.get("regime_period", 200))

    def _uptrend(self, candles: list[dict]) -> bool:
        """Item 3 regime gate: price above its regime-period SMA. Too little history -> flat."""
        closes = [c["close"] for c in candles]
        if len(closes) < self.regime_period + 1:
            return False
        ma = sma(closes, self.regime_period)
        return ma is not None and closes[-1] > ma

    def _clears(self, expected_move_pct: float) -> bool:
        """Item 7 pre-trade edge gate: skip entries that don't clear modeled friction."""
        from .. import costs
        return costs.clears_costs(expected_move_pct)

    def decide(self, candles: list[dict]) -> str:
        """Return 'BUY', 'SELL', or 'HOLD'. Must be deterministic and side-effect free."""
        raise NotImplementedError
