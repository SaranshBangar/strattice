"""Momentum / breakout. Close breaks above the lookback high by `threshold` -> BUY;
breaks below the lookback low by `threshold` -> SELL."""
from .base import Strategy


class Momentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 20))
        self.threshold = float(self.params.get("threshold", 0.03))
        self.min_candles = self.lookback + 1

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        window = closes[-self.lookback - 1:-1]  # exclude current bar
        hi, lo = max(window), min(window)
        c = closes[-1]
        if c > hi * (1 + self.threshold):
            return "BUY"
        if c < lo * (1 - self.threshold):
            return "SELL"
        return "HOLD"
