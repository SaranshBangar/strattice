"""RSI mean-reversion. RSI below oversold -> BUY; above overbought -> SELL."""
from .base import Strategy, rsi


class RSIMeanReversion(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 14))
        self.oversold = float(self.params.get("oversold", 30))
        self.overbought = float(self.params.get("overbought", 70))
        self.min_candles = self.period + 1

    def decide(self, candles: list[dict]) -> str:
        closes = [c["close"] for c in candles]
        r = rsi(closes, self.period)
        if r is None:
            return "HOLD"
        if r < self.oversold:
            return "BUY"
        if r > self.overbought:
            return "SELL"
        return "HOLD"
