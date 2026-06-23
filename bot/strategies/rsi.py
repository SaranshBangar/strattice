"""RSI mean-reversion, ENTRY-ONLY (item 4). A long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - RSI is DEEPLY oversold (default < 22, not the old 30),
  - a confirmation candle closes back above the prior bar's high, and
  - the expected move clears modeled friction (item 7).
Exits are owned by the engine/backtest protective layer (target >= 3x round-trip cost
OR a time-stop), NOT a bare RSI>50 flip — so this strategy never emits SELL.
"""
from .base import Strategy, rsi


class RSIMeanReversion(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 14))
        self.oversold = float(self.params.get("oversold", 22))
        self.expected_move = float(self.params.get("expected_move_pct", 0.05))
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
        # confirmation: current close back above the prior bar's high
        if candles[-1]["close"] <= candles[-2]["high"]:
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"
