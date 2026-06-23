"""MA Crossover, ENTRY-ONLY (item 5). A long fires only when:
  - the market is in an uptrend (regime gate, item 3),
  - fast is ABOVE slow by at least k*ATR (separation, not a bare cross — the gap filter IS
    the whipsaw kill; requiring the exact cross bar AND a gap is self-contradictory since
    fast~=slow at the cross),
  - the slow MA slope is positive, and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest ATR chandelier trailing stop, NOT an opposite cross — so
this strategy never emits SELL. Default periods widened (20/50) to cut churn. The engine
only buys when flat, so a sustained gap re-enters after an exit (trend re-entry), not every bar.
"""
from .base import Strategy, atr, sma


class MACrossover(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.fast = int(self.params.get("fast", 20))
        self.slow = int(self.params.get("slow", 50))
        self.atr_period = int(self.params.get("atr_period", 14))
        self.k_atr = float(self.params.get("k_atr", 0.5))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))  # cross must be this fresh
        self.expected_move = float(self.params.get("expected_move_pct", 0.05))
        self.min_candles = max(self.slow + 2, self.atr_period + 1, self.regime_period + 1, 2)

    def _recent_cross_up(self, closes: list[float]) -> bool:
        """True if fast crossed ABOVE slow within the last confirm_bars (re-arm needs a NEW
        cross, so a chandelier exit while still trending doesn't churn-rebuy)."""
        for j in range(self.confirm_bars):
            n = len(closes) - j
            af, as_, bf, bs = (sma(closes[:n], self.fast), sma(closes[:n], self.slow),
                               sma(closes[:n - 1], self.fast), sma(closes[:n - 1], self.slow))
            if None not in (af, as_, bf, bs) and bf <= bs and af > as_:
                return True
        return False

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        prev_s = sma(closes[:-1], self.slow)
        f, s = sma(closes, self.fast), sma(closes, self.slow)
        a = atr(candles, self.atr_period)
        if None in (prev_s, f, s, a):
            return "HOLD"
        gap_ok = (f - s) >= self.k_atr * a
        slope_ok = s > prev_s  # slow MA rising
        if self._recent_cross_up(closes) and gap_ok and slope_ok and self._clears(self.expected_move):
            return "BUY"
        return "HOLD"
