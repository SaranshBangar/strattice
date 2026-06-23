"""Moving Average Crossover. Fast SMA crossing ABOVE slow -> BUY; crossing BELOW -> SELL."""
from .base import Strategy, sma


class MACrossover(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.fast = int(self.params.get("fast", 10))
        self.slow = int(self.params.get("slow", 30))
        self.min_candles = self.slow + 1

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        prev_f, prev_s = sma(closes[:-1], self.fast), sma(closes[:-1], self.slow)
        f, s = sma(closes, self.fast), sma(closes, self.slow)
        if None in (prev_f, prev_s, f, s):
            return "HOLD"
        if prev_f <= prev_s and f > s:
            return "BUY"
        if prev_f >= prev_s and f < s:
            return "SELL"
        return "HOLD"
