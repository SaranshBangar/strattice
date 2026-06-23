"""Donchian breakout, ENTRY-ONLY (item 6). A long fires only when:
  - the market is in an uptrend (regime gate, item 3),
  - price breaks the prior N-bar high by a small buffer (Donchian upper),
  - ATR is above a volatility floor (no breakouts in dead chop),
  - volume is above its recent average (real participation),
  - price hasn't already run too far past the level (chase cap), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier / target / stop) — never SELL here.
"""
from .base import Strategy, atr, avg_volume


class Momentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 20))
        self.atr_period = int(self.params.get("atr_period", 14))
        self.vol_period = int(self.params.get("vol_period", 20))
        self.min_atr_frac = float(self.params.get("min_atr_frac", 0.01))   # vol floor: ATR >= 1% of price
        self.vol_mult = float(self.params.get("vol_mult", 1.2))            # volume >= 1.2x average
        self.buffer = float(self.params.get("buffer", 0.002))             # 0.2% entry buffer over the high
        self.max_chase = float(self.params.get("max_chase", 0.02))        # skip if >2% past the level
        self.expected_move = float(self.params.get("expected_move_pct", 0.05))
        self.min_candles = max(self.lookback + 1, self.atr_period + 1,
                               self.vol_period + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        highs = [c["high"] for c in candles]
        window_high = max(highs[-self.lookback - 1:-1])  # prior N-bar high, excl current
        a = atr(candles, self.atr_period)
        av = avg_volume(candles[:-1], self.vol_period)
        if a is None or av is None or window_high <= 0:
            return "HOLD"
        price = candles[-1]["close"]
        if a < self.min_atr_frac * price:                       # volatility floor
            return "HOLD"
        if candles[-1]["volume"] < self.vol_mult * av:          # volume confirmation
            return "HOLD"
        if price < window_high * (1 + self.buffer):             # break + buffer
            return "HOLD"
        if price > window_high * (1 + self.max_chase):          # chase cap
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"
