"""Strategy base + indicator helpers. Strategies are PURE: candles in -> BUY/SELL/HOLD out.
No I/O, no order placement, no position state. The engine owns side effects.

Candle = {"open","high","low","close","volume","time"} (ms), oldest-first.
"""
from __future__ import annotations


def sma(values: list[float], n: int) -> float | None:
    return sum(values[-n:]) / n if len(values) >= n else None


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

    def __init__(self, name: str, market: str, capital: float, params: dict):
        self.name = name
        self.market = market
        self.capital = float(capital)
        self.params = params

    def decide(self, candles: list[dict]) -> str:
        """Return 'BUY', 'SELL', or 'HOLD'. Must be deterministic and side-effect free."""
        raise NotImplementedError
