"""Multi-lookback Donchian trend consensus, ENTRY-ONLY.

STATUS: REJECTED (July 2026 v4 study) — kept ONLY so research/run_backtests.py can
reproduce the rejection. Never enable this live and never expose it on the platform.
The long-only spot adaptation failed venue robustness on real data: best variant
median +25.9% USDT but only 4/7 twins positive (ADA -47%, ETH/XRP negative in
variants), vs supertrend/tsmom/breakout which clear 5+/7 on both venues. The paper's
edge (Zarattini/Pagani/Barbon 2025, "Catching Crypto Trends", ensembles of 5..360-day
Donchian channels) relies on long/short symmetry and vol-targeted sizing that a
long-only, fixed-sleeve, 1.5-1.7%-friction spot bot cannot express.

Original hypothesis — a long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - at least min_agree_frac of the lookback models are LONG — model j is long when the
    close sits above the midline of its prior lookback_j-bar Donchian channel,
  - the consensus is FRESH (it was below the bar within the last confirm_bars) so a
    chandelier exit mid-trend doesn't churn-rebuy every bar, and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — this
module never emits SELL. One entry family, N clocks: agreement across fast AND slow
channels filters one-lookback luck without adding a single new indicator concept.
"""
from .base import Strategy

_DEFAULT_LOOKBACKS = (10, 20, 40, 80, 160)


class TrendEnsemble(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        lbs = self.params.get("lookbacks", list(_DEFAULT_LOOKBACKS))
        self.lookbacks = sorted(int(x) for x in lbs) or list(_DEFAULT_LOOKBACKS)
        self.min_agree_frac = float(self.params.get("min_agree_frac", 0.8))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(max(self.lookbacks) + 1 + self.confirm_bars,
                               self.regime_period + 1, 2)

    def _score(self, candles: list[dict], end: int) -> float | None:
        """Fraction of lookback models long at bar `end` (index into candles).
        Model j is long when close[end] > midline of the PRIOR lookback_j bars."""
        if end + 1 < max(self.lookbacks) + 1:
            return None
        close = candles[end]["close"]
        long_n = 0
        for lb in self.lookbacks:
            w = candles[end - lb:end]              # prior lb bars, excl current
            hi = max(c["high"] for c in w)
            lo = min(c["low"] for c in w)
            if close > (hi + lo) / 2.0:
                long_n += 1
        return long_n / len(self.lookbacks)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        last = len(candles) - 1
        score = self._score(candles, last)
        if score is None or score < self.min_agree_frac:
            return "HOLD"
        # fresh consensus: the score sat below the bar within the last confirm_bars
        fresh = False
        for j in range(1, self.confirm_bars + 1):
            prev = self._score(candles, last - j)
            if prev is not None and prev < self.min_agree_frac:
                fresh = True
                break
        if not fresh:
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY on a fresh full consensus, HOLD when stale or split."""
    def candles(closes):
        return [{"open": c, "high": c * 1.005, "low": c * 0.995, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"lookbacks": [5, 10, 20], "min_agree_frac": 0.99, "confirm_bars": 3,
              "regime_period": 10, "expected_move_pct": 0.08}
    s = TrendEnsemble("t", "M", params)

    # long flat base then a fresh 2-bar ramp above every channel midline ->
    # consensus just completed -> fresh -> BUY
    base = [100.0] * 30
    ramp = [101.0, 103.0]
    assert s.decide(candles(base + ramp)) == "BUY"

    # extend the ramp: consensus is now old news -> HOLD (no churn-rebuy)
    stale = base + ramp + [106.0, 110.0, 112.0, 114.0, 116.0, 118.0, 120.0]
    assert s.decide(candles(stale)) == "HOLD"

    # weak tape: price under every channel midline -> HOLD
    assert s.decide(candles(base + [99.5])) == "HOLD"

    assert s.decide(candles(base[:5])) == "HOLD"  # too few
    print("trend_ensemble self-check OK")


if __name__ == "__main__":
    demo()
