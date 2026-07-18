"""Trend-regime holder (Faber-style timing rule). The oldest documented trend edge:
be long while price holds above its long moving average, be flat below it (Faber's
"A Quantitative Approach to Tactical Asset Allocation" rule, widely replicated on BTC
with the 200-day line). Unlike the burst-entry engines (tsmom/breakout/accel), this
module HOLDS the whole bull regime and steps aside for the bear — the exit is part of
the strategy, so it emits SELL:
  - BUY  when the close is above SMA(period) by at least `band` (hysteresis, so a
    graze of the line doesn't churn) and the SMA itself is rising,
  - SELL when the close is below SMA(period) by at least `band`,
  - HOLD in the neutral zone between the two lines (positions ride, flat stays flat).
The hysteresis band is the whole anti-whipsaw defense: entries and exits happen at
different prices, so chop around the MA costs one round trip, not ten. Fires ~1-3
round trips per year — the friction-minimal expression of trend following.
"""
from .base import Strategy, sma


class TrendRegime(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 150))
        self.band = float(self.params.get("band", 0.02))          # 2% hysteresis each side
        self.slope_bars = int(self.params.get("slope_bars", 5))   # SMA must be rising over N bars
        self.expected_move = float(self.params.get("expected_move_pct", 0.10))
        self.min_candles = max(self.period + self.slope_bars + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        ma_now = sma(closes, self.period)
        ma_then = sma(closes[:-self.slope_bars], self.period)
        if ma_now is None or ma_then is None or ma_now <= 0:
            return "HOLD"
        price = closes[-1]
        if price < ma_now * (1 - self.band):                      # regime broken -> step aside
            return "SELL"
        if price > ma_now * (1 + self.band) and ma_now > ma_then:  # regime on + line rising
            if self._clears(self.expected_move):
                return "BUY"
        return "HOLD"                                             # neutral zone: no churn


def demo() -> None:
    """Assert-based self-check: BUY above a rising line, SELL below it, HOLD in the band."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"period": 10, "band": 0.02, "slope_bars": 3, "expected_move_pct": 0.10}
    s = TrendRegime("t", "M", params)

    climb = [100 * (1.01 ** i) for i in range(30)]                # well above a rising MA
    assert s.decide(candles(climb)) == "BUY"

    crash = climb + [climb[-1] * 0.80]                            # far below the MA
    assert s.decide(candles(crash)) == "SELL"

    flat = [100.0] * 30                                           # price == MA: neutral zone
    assert s.decide(candles(flat)) == "HOLD"

    assert s.decide(candles(climb[:5])) == "HOLD"                 # too few
    print("trend_regime self-check OK")


if __name__ == "__main__":
    demo()
