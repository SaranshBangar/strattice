"""MACD trend entry, ENTRY-ONLY. The classic EMA-momentum oscillator (12/26/9) traded
as a trend CONTINUATION signal, not a reversal one: a long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the MACD line crossed above its signal line within the last confirm_bars (fresh),
  - the MACD line itself is above zero if require_positive (the 12-EMA is above the
    26-EMA — momentum agrees with the trend, filtering counter-trend bounce crosses),
  - the histogram is expanding (momentum still building, not already fading), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — this
module never emits SELL.
"""
from .base import Strategy, ema_series


class MacdTrend(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.fast = int(self.params.get("fast", 12))
        self.slow = int(self.params.get("slow", 26))
        self.signal = int(self.params.get("signal", 9))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))
        self.require_positive = bool(self.params.get("require_positive", True))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.slow + self.signal + self.confirm_bars + 2,
                               self.regime_period + 1, 2)
        # EMAs are recursive, so compute MACD over a FIXED-length trailing slice:
        # decisions are identical for any window >= trunc bars (bounded-window/live parity).
        self.trunc = self.min_candles + 200

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        candles = candles[-self.trunc:]
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        f, s = ema_series(closes, self.fast), ema_series(closes, self.slow)
        macd = [a - b for a, b in zip(f, s)]
        sig = ema_series(macd, self.signal)
        hist = [m - g for m, g in zip(macd, sig)]
        if hist[-1] <= 0:
            return "HOLD"
        if self.require_positive and macd[-1] <= 0:
            return "HOLD"
        # fresh cross: histogram was <= 0 within the last confirm_bars bars before now
        recent = hist[-1 - self.confirm_bars:-1]
        if not recent or all(h > 0 for h in recent):
            return "HOLD"
        if hist[-1] <= recent[-1]:                                # must be expanding
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY on a fresh positive cross, HOLD when stale."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"fast": 6, "slow": 13, "signal": 5, "confirm_bars": 3,
              "require_positive": True, "regime_period": 10, "expected_move_pct": 0.08}
    s = MacdTrend("t", "M", params)

    # long climb: MACD above signal for ages -> stale -> HOLD
    climb = [100 * (1.01 ** i) for i in range(60)]
    assert s.decide(candles(climb)) == "HOLD"

    # climb, shallow pullback (histogram dips negative), then a strong resumption -> BUY
    seq = (climb + [climb[-1] * (0.995 ** j) for j in range(1, 7)]
           + [climb[-1] * 0.995 ** 6 * (1.025 ** j) for j in range(1, 5)])
    assert s.decide(candles(seq)) == "BUY", s.decide(candles(seq))

    assert s.decide(candles(climb[:8])) == "HOLD"                 # too few
    print("macd_trend self-check OK")


if __name__ == "__main__":
    demo()
