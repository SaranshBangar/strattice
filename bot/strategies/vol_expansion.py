"""Volatility-expansion breakout, ENTRY-ONLY. Aggressive 15m strategy. A long fires only when:
  - the market is in an uptrend (regime gate, item 3; looser period than the trend followers),
  - short-window ATR has EXPANDED vs the longer ATR (atr_short >= mult * atr_long) — a vol pop,
  - the current close is the highest close of the last breakout_lookback bars (new local high), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier / stop) — never SELL here.
"""
from .base import Strategy, atr


class VolExpansion(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.short_atr = int(self.params.get("short_atr", 8))
        self.long_atr = int(self.params.get("long_atr", 32))
        self.expansion_mult = float(self.params.get("expansion_mult", 1.3))   # short ATR >= mult*long ATR
        self.breakout_lookback = int(self.params.get("breakout_lookback", 16))
        self.expected_move = float(self.params.get("expected_move_pct", 0.03))
        self.min_candles = max(self.long_atr + 1, self.breakout_lookback + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        a_short = atr(candles, self.short_atr)
        a_long = atr(candles, self.long_atr)
        if a_short is None or a_long is None or a_long <= 0:
            return "HOLD"
        if a_short < self.expansion_mult * a_long:                       # require a volatility pop
            return "HOLD"
        closes = [c["close"] for c in candles]
        if closes[-1] < max(closes[-self.breakout_lookback - 1:-1]):     # must be a new local high
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"
