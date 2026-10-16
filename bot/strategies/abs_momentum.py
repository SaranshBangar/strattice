"""Absolute (time-series) momentum regime holder (v9).

The holding form of time-series momentum (Moskowitz/Ooi/Pedersen; Antonacci's
"absolute momentum"): be long while the asset's own trailing return over a long
window is positive, flat while it is negative. Where `tsmom` is a burst entry that
needs a +10% month near the highs and then hands the position to a chandelier trail,
this engine holds the whole regime and owns its exit - the same signal that admits a
position also ends it, with a hysteresis band so a return hovering at zero does not
churn round trips.

  - BUY  when the `lookback`-bar return >= +entry_return AND the `fast`-bar return
         is positive (the trend is still pushing, not just a stale base effect),
  - SELL when the `lookback`-bar return <= -exit_return,
  - HOLD in between.
"""
from .base import Strategy


class AbsMomentum(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 90))
        self.fast = int(self.params.get("fast", 20))
        self.entry_return = float(self.params.get("entry_return", 0.05))
        self.exit_return = float(self.params.get("exit_return", 0.0))
        self.expected_move = float(self.params.get("expected_move_pct", 0.10))
        self.min_candles = max(self.lookback + 1, self.fast + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        base, fbase = closes[-self.lookback - 1], closes[-self.fast - 1]
        if base <= 0 or fbase <= 0:
            return "HOLD"
        ret = closes[-1] / base - 1
        if ret <= -self.exit_return:
            return "SELL"
        if ret >= self.entry_return and closes[-1] > fbase:
            if self._clears(self.expected_move):
                return "BUY"
        return "HOLD"


def demo() -> None:
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    s = AbsMomentum("a", "M", {"lookback": 20, "fast": 5, "entry_return": 0.05,
                               "exit_return": 0.0, "expected_move_pct": 0.10})
    climb = [100 * (1.01 ** i) for i in range(30)]
    assert s.decide(candles(climb)) == "BUY"
    fall = [100 * (0.99 ** i) for i in range(30)]
    assert s.decide(candles(fall)) == "SELL"
    # long-window return positive but the fast window rolled over -> no new entry
    stall = climb + [climb[-1] * 0.97] * 6
    assert s.decide(candles(stall)) == "HOLD"
    assert s.decide(candles(climb[:5])) == "HOLD"
    print("abs_momentum self-check OK")


if __name__ == "__main__":
    demo()
