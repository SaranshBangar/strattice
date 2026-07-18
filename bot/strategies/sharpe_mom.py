"""Risk-adjusted momentum, ENTRY-ONLY. The published refinement of raw TSMOM
(risk-managed momentum / volatility-scaled trend literature): divide the lookback
return by its realized volatility, so a +20% grind on 2% daily noise scores far higher
than a +20% lottery on 8% daily noise. High raw momentum with huge volatility is where
momentum crashes live; normalizing by vol is the documented fix. A long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the annualization-free score  (lookback return) / (per-bar vol * sqrt(lookback))
    is >= min_score (clean, persistent thrust),
  - the lookback return itself >= min_return (score alone can't promote a microscopic
    drift in a dead tape),
  - the close sits within near_high_frac of the lookback high (continuation, not a
    fading spike), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — this
module never emits SELL.
"""
import math

from .base import Strategy, stdev


class SharpeMomentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 30))
        self.min_score = float(self.params.get("min_score", 1.5))
        self.min_return = float(self.params.get("min_return", 0.06))
        self.near_high_frac = float(self.params.get("near_high_frac", 0.03))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.lookback + 2, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        base = closes[-self.lookback - 1]
        if base <= 0:
            return "HOLD"
        ret = closes[-1] / base - 1
        if ret < self.min_return:
            return "HOLD"
        rets = [closes[i] / closes[i - 1] - 1 for i in range(-self.lookback, 0)
                if closes[i - 1] > 0]
        vol = stdev(rets, len(rets))
        if vol is None or vol <= 0:
            return "HOLD"
        score = ret / (vol * math.sqrt(self.lookback))            # vol-normalized thrust
        if score < self.min_score:
            return "HOLD"
        window_high = max(c["high"] for c in candles[-self.lookback:])
        if closes[-1] < window_high * (1 - self.near_high_frac):  # not rolling over
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: clean climb BUYs; same net move on violent noise HOLDs."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"lookback": 20, "min_score": 1.5, "min_return": 0.05, "near_high_frac": 0.03,
              "regime_period": 10, "expected_move_pct": 0.08}
    s = SharpeMomentum("t", "M", params)

    clean = [100 * (1.008 ** i) for i in range(40)]               # steady low-vol climb
    assert s.decide(candles(clean)) == "BUY"

    # same endpoint, violent alternating path -> vol-normalized score collapses -> HOLD
    noisy = list(clean)
    for i in range(20, 39):
        noisy[i] = clean[i] * (1.10 if i % 2 else 0.90)
    assert s.decide(candles(noisy)) == "HOLD"

    flat = [100.0] * 40                                           # no return at all
    assert s.decide(candles(flat)) == "HOLD"

    assert s.decide(candles(clean[:5])) == "HOLD"                 # too few
    print("sharpe_mom self-check OK")


if __name__ == "__main__":
    demo()
