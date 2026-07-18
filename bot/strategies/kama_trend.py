"""KAMA trend follower (Kaufman's Adaptive Moving Average). A moving average whose
smoothing constant adapts to the market's efficiency ratio — it speeds up when price
moves cleanly (trend) and flattens to a crawl in noise (chop), which is exactly the
whipsaw defense a fixed-period MA lacks. Long logic, with the exit part of the edge:
  - BUY  when the close is above KAMA by `entry_band`, KAMA itself is rising over
    `slope_bars`, and the efficiency ratio >= min_er (the move is clean, not noise),
  - SELL when the close drops below KAMA by `exit_band` (the adaptive line is the
    trailing regime floor),
  - HOLD otherwise.
Standard Kaufman construction: ER = |net change| / sum(|bar changes|) over er_period;
smoothing constant sc = (ER*(2/(fast+1) - 2/(slow+1)) + 2/(slow+1))^2.
"""
from .base import Strategy


def kama_series(closes: list[float], er_period: int, fast: int, slow: int) -> list[float | None]:
    """Per-bar KAMA (None until er_period+1 values exist). Deterministic, O(n)."""
    n = len(closes)
    out: list[float | None] = [None] * n
    if n <= er_period:
        return out
    fast_sc, slow_sc = 2.0 / (fast + 1), 2.0 / (slow + 1)
    kama = sum(closes[:er_period + 1]) / (er_period + 1)   # seed: simple mean of the warmup
    out[er_period] = kama
    for i in range(er_period + 1, n):
        change = abs(closes[i] - closes[i - er_period])
        volatility = sum(abs(closes[j] - closes[j - 1]) for j in range(i - er_period + 1, i + 1))
        er = change / volatility if volatility > 0 else 0.0
        sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2
        kama = kama + sc * (closes[i] - kama)
        out[i] = kama
    return out


def efficiency_ratio(closes: list[float], er_period: int) -> float | None:
    if len(closes) < er_period + 1:
        return None
    change = abs(closes[-1] - closes[-er_period - 1])
    volatility = sum(abs(closes[i] - closes[i - 1]) for i in range(-er_period, 0))
    return change / volatility if volatility > 0 else 0.0


class KamaTrend(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.er_period = int(self.params.get("er_period", 10))
        self.fast = int(self.params.get("fast", 2))
        self.slow = int(self.params.get("slow", 30))
        self.entry_band = float(self.params.get("entry_band", 0.01))
        self.exit_band = float(self.params.get("exit_band", 0.01))
        self.slope_bars = int(self.params.get("slope_bars", 3))
        self.min_er = float(self.params.get("min_er", 0.30))     # only act on clean moves
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.er_period + self.slope_bars + 2,
                               self.regime_period + 1, 2)
        # KAMA is recursive (each value depends on all prior bars), so compute it over a
        # FIXED-length trailing slice: decisions are identical for any window >= trunc bars,
        # which keeps backtest bounded-window parity AND live (candle_limit) parity exact.
        self.trunc = self.min_candles + 200

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        candles = candles[-self.trunc:]
        closes = [c["close"] for c in candles]
        kseries = kama_series(closes, self.er_period, self.fast, self.slow)
        k_now, k_then = kseries[-1], kseries[-1 - self.slope_bars]
        if k_now is None or k_then is None or k_now <= 0:
            return "HOLD"
        price = closes[-1]
        if price < k_now * (1 - self.exit_band):                 # adaptive floor broken
            return "SELL"
        er = efficiency_ratio(closes, self.er_period)
        if (price > k_now * (1 + self.entry_band) and k_now > k_then
                and er is not None and er >= self.min_er
                and self._uptrend(candles)
                and self._clears(self.expected_move)):
            return "BUY"
        return "HOLD"


def demo() -> None:
    """Assert-based self-check: BUY on a clean climb, SELL under the line, HOLD in noise."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"er_period": 8, "fast": 2, "slow": 20, "entry_band": 0.005, "exit_band": 0.005,
              "slope_bars": 3, "min_er": 0.3, "regime_period": 10, "expected_move_pct": 0.08}
    s = KamaTrend("t", "M", params)

    climb = [100 * (1.01 ** i) for i in range(40)]               # clean trend: ER ~ 1
    assert s.decide(candles(climb)) == "BUY"

    crash = climb + [climb[-1] * 0.85]                           # far below the adaptive line
    assert s.decide(candles(crash)) == "SELL"

    noise = [100 + (1 if i % 2 else -1) for i in range(40)]      # pure chop: ER ~ 0
    assert s.decide(candles(noise)) in ("HOLD", "SELL")          # never BUY into noise
    assert s.decide(candles(noise)) != "BUY"

    assert s.decide(candles(climb[:5])) == "HOLD"                # too few
    print("kama_trend self-check OK")


if __name__ == "__main__":
    demo()
