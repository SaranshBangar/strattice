"""Acceleration momentum, ENTRY-ONLY. The disciplined version of "ape the parabola":
buy momentum that is not just positive but ACCELERATING — the recent leg is outrunning
the leg before it — as price makes fresh highs on expanding volume. This is a more
aggressive cousin of tsmom/Donchian: instead of "trend is up", it demands "trend is
speeding up", which fires later and harder into the fat right tail. A long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the recent `fast` -bar return is positive and >= min_return (real thrust, not drift),
  - that recent return exceeds the immediately-preceding `fast` -bar return by an
    accel_mult factor (second derivative positive — momentum is accelerating),
  - the close is the highest close of the last `breakout_lookback` bars (making highs,
    not accelerating into a lower high), and
  - the current bar's volume is above its recent average (real participation), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — the fat
right tail of a parabola is exactly what amortizes the ~1.5-1.7% India round trip; this
module never emits SELL.
"""
from .base import Strategy, avg_volume


class AccelerationMomentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.fast = int(self.params.get("fast", 10))
        self.min_return = float(self.params.get("min_return", 0.05))     # recent leg >= +5%
        self.accel_mult = float(self.params.get("accel_mult", 1.5))      # recent >= 1.5x prior leg
        self.breakout_lookback = int(self.params.get("breakout_lookback", 20))
        self.vol_period = int(self.params.get("vol_period", 20))
        self.vol_mult = float(self.params.get("vol_mult", 1.0))
        self.expected_move = float(self.params.get("expected_move_pct", 0.06))
        self.min_candles = max(2 * self.fast + 1, self.breakout_lookback + 1,
                               self.vol_period + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]

        p_now = closes[-1]
        p_mid = closes[-self.fast - 1]
        p_old = closes[-2 * self.fast - 1]
        if p_mid <= 0 or p_old <= 0:
            return "HOLD"
        ret_recent = p_now / p_mid - 1                                   # latest fast-bar leg
        ret_prior = p_mid / p_old - 1                                    # the leg before it
        if ret_recent < self.min_return:                                # real thrust required
            return "HOLD"
        # acceleration: the recent leg must outrun the prior leg. Guard the prior<=0 case so a
        # bounce off a flat/down leg still qualifies (any positive thrust beats a non-positive prior).
        if ret_prior > 0 and ret_recent < self.accel_mult * ret_prior:
            return "HOLD"

        if p_now < max(closes[-self.breakout_lookback - 1:-1]):          # must be a new local high
            return "HOLD"

        av = avg_volume(candles[:-1], self.vol_period)
        if av is None or candles[-1]["volume"] < self.vol_mult * av:     # participation
            return "HOLD"

        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY when the recent leg accelerates into a new high;
    HOLD on steady (non-accelerating) drift, and HOLD when momentum is decelerating."""
    def candles(closes, vols=None):
        return [{"open": c, "high": c * 1.001, "low": c * 0.999, "close": c,
                 "volume": (vols[i] if vols else 1.0), "time": i * 86_400_000}
                for i, c in enumerate(closes)]

    params = {"fast": 5, "min_return": 0.05, "accel_mult": 1.5, "breakout_lookback": 10,
              "vol_period": 10, "vol_mult": 1.0, "regime_period": 10, "expected_move_pct": 0.06}
    s = AccelerationMomentum("a", "M", params)

    # Steady +1%/bar climb: uptrend + new highs, but recent leg ~= prior leg (no accel) -> HOLD.
    steady = [100 * (1.01 ** i) for i in range(40)]
    assert s.decide(candles(steady)) == "HOLD", s.decide(candles(steady))

    # Accelerating: gentle climb, then a sharp final 5-bar burst -> BUY.
    accel = [100 * (1.005 ** i) for i in range(30)]
    accel += [accel[-1] * (1.04 ** j) for j in range(1, 6)]           # last leg far outruns the prior
    assert s.decide(candles(accel)) == "BUY", s.decide(candles(accel))

    # Decelerating: sharp early burst, then a limp final leg into a lower-high -> HOLD.
    decel = [100 * (1.04 ** i) for i in range(15)] + [100 * 1.04 ** 14 * (1.001 ** j)
                                                      for j in range(1, 11)]
    assert s.decide(candles(decel)) == "HOLD"

    assert s.decide(candles(accel[:6])) == "HOLD"                     # too few
    print("acceleration self-check OK")


if __name__ == "__main__":
    demo()
