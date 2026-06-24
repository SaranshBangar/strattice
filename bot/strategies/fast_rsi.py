"""Fast RSI mean-reversion, ENTRY-ONLY. Aggressive 15m sibling of the conservative `rsi` strategy:
a shorter RSI period and a LOOSER oversold threshold for more dip-buys, but still gated. A long
fires only when:
  - the market is in an uptrend (regime gate, item 3; looser period than the trend followers),
  - a short RSI is oversold (default < 32, looser than the conservative 22),
  - a confirmation candle closes back above the prior bar's high, and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (target / time-stop) — never SELL here.
"""
from .base import Strategy, rsi


class FastRSIReversion(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 7))
        self.oversold = float(self.params.get("oversold", 32))
        self.expected_move = float(self.params.get("expected_move_pct", 0.03))
        self.min_candles = max(self.period + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        r = rsi(closes, self.period)
        if r is None or r >= self.oversold:
            return "HOLD"
        if candles[-1]["close"] <= candles[-2]["high"]:          # confirmation: close above prior high
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"
