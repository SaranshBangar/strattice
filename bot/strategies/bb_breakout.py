"""Bollinger-band breakout trend holder (v9).

The trend-following reading of Bollinger bands (the opposite of the retired
bb_reversion): a close above the upper band is not "overbought", it is a volatility-
adjusted breakout - price moved further than its own recent noise explains. Hold the
move until price falls back to (or through) the middle of the bands.

  - BUY  when close > SMA(period) + k * stdev(period), the close is above the regime
         SMA (regime_period, 0 disables) and the expected move clears friction,
  - SELL when close < SMA(period) + exit_k * stdev(period)  (exit_k 0 = the middle
         band, -1 = one deviation under it - a wider, slower exit),
  - HOLD otherwise.
"""
import math

from .base import Strategy, sma


class BBBreakout(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 20))
        self.k = float(self.params.get("k", 2.0))
        self.exit_k = float(self.params.get("exit_k", 0.0))
        self.regime_period = int(self.params.get("regime_period", 100))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.period + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        w = closes[-self.period:]
        mid = sum(w) / self.period
        sd = math.sqrt(sum((x - mid) ** 2 for x in w) / self.period)
        price = closes[-1]
        if price < mid + self.exit_k * sd:
            return "SELL"
        if sd <= 0 or price <= mid + self.k * sd:
            return "HOLD"
        if self.regime_period:
            ma = sma(closes, self.regime_period)
            if ma is None or price <= ma:
                return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    s = BBBreakout("b", "M", {"period": 10, "k": 2.0, "exit_k": 0.0,
                              "regime_period": 0, "expected_move_pct": 0.10})
    base = [100.0, 101.0] * 6
    assert s.decide(candles(base + [110.0])) == "BUY"       # far above the upper band
    assert s.decide(candles(base + [100.0])) == "SELL"      # under the middle band
    assert s.decide(candles(base + [101.0])) == "HOLD"      # inside, above the middle
    gated = BBBreakout("b", "M", {"period": 10, "k": 2.0, "regime_period": 30,
                                  "expected_move_pct": 0.10})
    down = [200 - 3 * i for i in range(30)] + [110.0, 111.0] * 5
    assert gated.decide(candles(down + [118.0])) == "HOLD"  # breakout under the regime SMA
    print("bb_breakout self-check OK")


if __name__ == "__main__":
    demo()
