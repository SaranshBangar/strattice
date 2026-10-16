"""Turtle-style Donchian channel system with its OWN channel exit (v9).

The classic Turtle rules, long-only spot: enter on a close above the prior
`entry_lookback`-bar high, exit on a close below the prior `exit_lookback`-bar low.
Unlike `momentum` (entry-only, chandelier exit, volume/ATR gates), the exit channel is
part of the strategy - the asymmetric entry/exit windows ARE the anti-whipsaw defense
(a long entry needs a fresh N-day high, the exit waits for a fresh M-day low, so chop
inside the channel costs nothing). Emits SELL, so it runs without a chandelier.

  - BUY  when close > max(high[-entry_lookback-1:-1]) and (regime_period == 0 or the
         close is above its regime SMA),
  - SELL when close < min(low[-exit_lookback-1:-1]),
  - HOLD otherwise.
"""
from .base import Strategy, sma


class DonchianTrend(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.entry_lookback = int(self.params.get("entry_lookback", 55))
        self.exit_lookback = int(self.params.get("exit_lookback", 20))
        # 0 disables the regime gate: the channel itself is the trend filter
        self.regime_period = int(self.params.get("regime_period", 0))
        self.expected_move = float(self.params.get("expected_move_pct", 0.10))
        self.min_candles = max(self.entry_lookback + 1, self.exit_lookback + 1,
                               self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        price = candles[-1]["close"]
        exit_low = min(c["low"] for c in candles[-self.exit_lookback - 1:-1])
        if price < exit_low:
            return "SELL"
        entry_high = max(c["high"] for c in candles[-self.entry_lookback - 1:-1])
        if price <= entry_high:
            return "HOLD"
        if self.regime_period:
            ma = sma([c["close"] for c in candles], self.regime_period)
            if ma is None or price <= ma:
                return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    s = DonchianTrend("d", "M", {"entry_lookback": 10, "exit_lookback": 5,
                                 "expected_move_pct": 0.10})
    flat = [100.0] * 12
    assert s.decide(candles(flat + [101.0])) == "BUY"        # fresh 10-bar high
    assert s.decide(candles(flat + [100.0])) == "HOLD"       # inside the channel
    assert s.decide(candles(flat + [99.0])) == "SELL"        # under the 5-bar low
    # asymmetric windows: a dip that holds above the 5-bar low is not an exit
    up = [100 + i for i in range(15)]
    assert s.decide(candles(up + [up[-1] - 2])) == "HOLD"
    gated = DonchianTrend("d", "M", {"entry_lookback": 10, "exit_lookback": 5,
                                     "regime_period": 25, "expected_move_pct": 0.10})
    down = [200 - 5 * i for i in range(20)] + [130.0] * 10
    assert gated.decide(candles(down + [131.0])) == "HOLD"   # breakout under the regime line
    assert s.decide(candles(flat[:5])) == "HOLD"
    print("donchian_trend self-check OK")


if __name__ == "__main__":
    demo()
