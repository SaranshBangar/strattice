"""Time-series momentum, ENTRY-ONLY. The most robust documented crypto edge (TSMOM /
trend continuation): buy strength, not dips. A long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the lookback-bar return exceeds min_return (real momentum, not drift),
  - the close sits within near_high_frac of the lookback high (continuation, not a
    fading spike — we don't buy momentum that is already rolling over), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — the fat
right tail of trend winners is what amortizes the ~1.5-1.7% India round trip; this
module never emits SELL.
"""
from .base import Strategy


class TSMomentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 30))
        self.min_return = float(self.params.get("min_return", 0.05))
        self.near_high_frac = float(self.params.get("near_high_frac", 0.02))
        self.expected_move = float(self.params.get("expected_move_pct", 0.06))
        self.min_candles = max(self.lookback + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        base = closes[-self.lookback - 1]
        if base <= 0:
            return "HOLD"
        if closes[-1] / base - 1 < self.min_return:              # momentum threshold
            return "HOLD"
        window_high = max(c["high"] for c in candles[-self.lookback:])
        if closes[-1] < window_high * (1 - self.near_high_frac):  # not rolling over
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: one BUY, one near-miss (rolled over), one too-few."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 3_600_000} for i, c in enumerate(closes)]

    params = {"lookback": 20, "min_return": 0.05, "near_high_frac": 0.02,
              "regime_period": 10, "expected_move_pct": 0.06}
    s = TSMomentum("t", "M", params)

    climb = [100 * (1.006 ** i) for i in range(40)]          # steady +0.6%/bar climb
    assert s.decide(candles(climb)) == "BUY", s.decide(candles(climb))

    rolled = climb + [climb[-1] * 0.95]                       # 5% off the high -> no chase
    assert s.decide(candles(rolled)) == "HOLD"

    assert s.decide(candles(climb[:5])) == "HOLD"             # too few
    print("tsmom self-check OK")


if __name__ == "__main__":
    demo()
