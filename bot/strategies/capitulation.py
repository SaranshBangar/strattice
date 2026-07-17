"""Capitulation reversal, ENTRY-ONLY. The disciplined version of "buy blood in the
streets": ape into a violent oversold crash, but ONLY after a confirmed bounce bar, so
we catch the recoil instead of a still-falling knife. Unlike every other module here,
this one DELIBERATELY does not require the uptrend regime gate — capitulation lows print
below the trend MA by definition; gating them to an uptrend would suppress the whole
signal. A long fires only when:
  - price has crashed >= crash_drop off its recent `crash_lookback` high (a cascade), but
  - not more than max_drop (an anti-death-spiral guard: a >max_drop collapse is a
    delisting / broken market, not a dip worth catching),
  - RSI is deeply oversold (real capitulation, not a shallow pullback),
  - the current bar is a GREEN reversal bar closing above the prior close (the bounce is
    underway — we are not catching the knife mid-fall),
  - the bounce bar carries above-average volume (participation in the reversal), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer. Because a reversal that does not follow
through must be cut fast (there is no trend to ride), this module pairs best with a hard
stop + a time-stop, not a loose chandelier — see the candidate/config exits. Never SELL
here.
"""
from .base import Strategy, avg_volume, rsi


class CapitulationReversal(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.crash_lookback = int(self.params.get("crash_lookback", 10))
        self.crash_drop = float(self.params.get("crash_drop", 0.15))     # >= 15% off the recent high
        self.max_drop = float(self.params.get("max_drop", 0.45))         # anti-death-spiral ceiling
        self.rsi_period = int(self.params.get("rsi_period", 14))
        self.oversold = float(self.params.get("oversold", 22))
        self.vol_period = int(self.params.get("vol_period", 20))
        self.vol_mult = float(self.params.get("vol_mult", 1.2))          # bounce bar vol >= 1.2x avg
        self.expected_move = float(self.params.get("expected_move_pct", 0.06))
        self.min_candles = max(self.crash_lookback + 1, self.rsi_period + 1,
                               self.vol_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        # NOTE: no self._uptrend() gate here — capitulation is a downtrend event by design.
        closes = [c["close"] for c in candles]
        price = closes[-1]

        recent_high = max(c["high"] for c in candles[-self.crash_lookback - 1:])
        if recent_high <= 0:
            return "HOLD"
        drop = 1 - price / recent_high
        if drop < self.crash_drop or drop > self.max_drop:               # cascade, but not a collapse
            return "HOLD"

        r = rsi(closes, self.rsi_period)
        if r is None or r > self.oversold:                               # must be deeply oversold
            return "HOLD"

        cur = candles[-1]
        if not (cur["close"] > cur["open"] and cur["close"] > closes[-2]):  # green reversal bar
            return "HOLD"

        av = avg_volume(candles[:-1], self.vol_period)
        if av is None or cur["volume"] < self.vol_mult * av:             # participation in the bounce
            return "HOLD"

        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY on a confirmed capitulation bounce; HOLD on a still-
    falling knife, a shallow dip, and an off-the-cliff collapse."""
    def candles(rows):
        # rows: (open, high, low, close, volume)
        return [{"open": o, "high": h, "low": l, "close": c, "volume": v,
                 "time": i * 86_400_000} for i, (o, h, l, c, v) in enumerate(rows)]

    params = {"crash_lookback": 8, "crash_drop": 0.15, "max_drop": 0.45, "rsi_period": 14,
              "oversold": 30, "vol_period": 10, "vol_mult": 1.2, "expected_move_pct": 0.06}
    s = CapitulationReversal("c", "M", params)

    # A calm base, then a ~28% multi-bar cascade, then a green high-volume bounce bar.
    base = [(100, 101, 99, 100, 1.0)] * 14
    crash = [(98, 98, 92, 93, 2.0), (93, 93, 85, 86, 2.5), (86, 86, 78, 79, 3.0),
             (79, 79, 71, 72, 3.5)]                                   # ~28% off the 100 high, RSI deep
    bounce = [(72, 80, 71, 79, 4.0)]                                  # green, closes above prior 72, vol pop
    assert s.decide(candles(base + crash + bounce)) == "BUY", s.decide(candles(base + crash + bounce))

    # Still falling: a RED bar (no confirmation) at the same lows -> HOLD.
    knife = [(72, 73, 65, 66, 4.0)]
    assert s.decide(candles(base + crash + knife)) == "HOLD"

    # Shallow dip: only ~6% off the high -> not capitulation -> HOLD.
    dip = [(100, 101, 99, 100, 1.0)] * 14 + [(98, 98, 94, 94, 2.0), (94, 96, 93, 95, 1.5)]
    assert s.decide(candles(dip)) == "HOLD"

    # Off-the-cliff collapse: ~60% down (> max_drop) with a bounce bar -> HOLD (death-spiral guard).
    collapse = [(60, 60, 45, 46, 3.0), (46, 46, 35, 36, 3.0), (36, 44, 35, 43, 4.0)]
    assert s.decide(candles(base + collapse)) == "HOLD"

    print("capitulation self-check OK")


if __name__ == "__main__":
    demo()
