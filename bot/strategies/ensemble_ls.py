"""Long/short multi-lookback Donchian ensemble (v8 research module).

STATUS: RESEARCH-ONLY (July 2026 v8 long/short study). This is the TRUE form of
the edge behind the v4-REJECTED long-only `trend_ensemble`: the published result
(Zarattini/Pagani/Barbon 2025, "Catching Crypto Trends") holds positions BOTH
directions, which a spot bot cannot express — that inexpressibility was the v4
rejection reason. With backtest-level short support the symmetric form can now
be measured honestly. Emits "SHORT"/"COVER" tokens that only
bot/backtest.py:run(allow_short=True) honors; the LIVE engine ignores them
(exact "BUY"/"SELL" matches only), so configured live this module degrades to a
long-only ensemble and can never place a short order.

Signal — model j is long when the close sits above the midline of its prior
lookback_j-bar Donchian channel; `score` = fraction of models long:
  score >= enter_frac  and the consensus is FRESH (was below within
                        confirm_bars)                     -> BUY  (else COVER)
  score <= 1-enter_frac and fresh                         -> SHORT (else SELL)
  exit_frac <= score < enter_frac                         -> COVER (weak longs hold,
                                                            shorts are wrong-side)
  score < exit_frac                                       -> SELL  (longs are
                                                            wrong-side, shorts hold)
The stale-extreme fallbacks (COVER/SELL) are position-conditional no-ops in the
backtester, so one token safely serves both sides. No long-only regime gate:
the short side is the down-regime expression.
"""
from .base import Strategy

_DEFAULT_LOOKBACKS = (10, 20, 40, 80, 160)


class EnsembleLS(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        lbs = self.params.get("lookbacks", list(_DEFAULT_LOOKBACKS))
        self.lookbacks = sorted(int(x) for x in lbs) or list(_DEFAULT_LOOKBACKS)
        self.enter_frac = float(self.params.get("enter_frac", 0.8))
        self.exit_frac = float(self.params.get("exit_frac", 0.5))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.lookbacks) + 1 + self.confirm_bars

    def _score(self, candles: list[dict], end: int) -> float | None:
        """Fraction of lookback models long at bar `end` (same math as trend_ensemble)."""
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

    def _fresh(self, candles: list[dict], last: int, threshold: float, below: bool) -> bool:
        """True if the score sat on the OTHER side of `threshold` within confirm_bars."""
        for j in range(1, self.confirm_bars + 1):
            prev = self._score(candles, last - j)
            if prev is None:
                continue
            if (prev < threshold) if below else (prev > threshold):
                return True
        return False

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        last = len(candles) - 1
        score = self._score(candles, last)
        if score is None:
            return "HOLD"
        if score >= self.enter_frac:
            if self._fresh(candles, last, self.enter_frac, below=True) \
                    and self._clears(self.expected_move):
                return "BUY"
            return "COVER"
        if score <= 1.0 - self.enter_frac:
            if self._fresh(candles, last, 1.0 - self.enter_frac, below=False) \
                    and self._clears(self.expected_move):
                return "SHORT"
            return "SELL"
        if score >= self.exit_frac:
            return "COVER"
        return "SELL"


def demo() -> None:
    """Assert-based self-check: fresh consensus each side, stale no-ops, neutral exits."""
    def candles(closes):
        return [{"open": c, "high": c * 1.005, "low": c * 0.995, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"lookbacks": [5, 10, 20], "enter_frac": 0.99, "exit_frac": 0.5,
              "confirm_bars": 3, "expected_move_pct": 0.08}
    s = EnsembleLS("e", "M", params)

    flat = [100.0] * 30
    # fresh full consensus up off a flat base -> BUY; ride it until stale -> COVER (no-op long)
    assert s.decide(candles(flat + [101.0, 103.0])) == "BUY"
    stale_up = flat + [101.0, 103.0, 106.0, 110.0, 114.0, 118.0, 122.0]
    assert s.decide(candles(stale_up)) == "COVER"
    # fresh full consensus down needs a rising base first (a flat tape already scores 0):
    # crash through every channel midline -> SHORT; keep falling until stale -> SELL (no-op short)
    rising = [100.0 + i for i in range(30)]
    assert s.decide(candles(rising + [110.0, 95.0])) == "SHORT"
    stale_dn = rising + [110.0, 95.0, 90.0, 85.0, 80.0, 75.0, 70.0]
    assert s.decide(candles(stale_dn)) == "SELL"
    assert s.decide(candles(flat[:8])) == "HOLD"           # too few bars
    print("ensemble_ls self-check OK")


if __name__ == "__main__":
    demo()
