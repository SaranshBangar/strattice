"""Volatility-squeeze breakout, ENTRY-ONLY. Aggressive TTM-squeeze-style trend entry. A long
fires only when:
  - the market is in an uptrend (shared regime gate, item 3, looser period than trend followers),
  - there is enough range to clear friction (vol floor: ATR >= min_atr_frac * price),
  - a SQUEEZE was on within the last squeeze_lookback bars — Bollinger band half-width compressed
    INSIDE the Keltner half-width (k_bb*stdev(closes) < k_kc*ATR): low-vol coil before expansion,
  - the current close BREAKS the prior lookback-bar high + buffer (Donchian upper),
  - the break is not already chased (close <= prior high * (1 + max_chase)),
  - volume confirms participation (current volume >= vol_mult * trailing average), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest ATR chandelier trail + hard stop (no take-profit, no time-stop — let
the trend run); never SELL here. The fat right tail of trend winners is what amortizes the
~1.5-1.7% round-trip friction (0.47% fee+GST + 1% TDS per sell).
"""
from .base import Strategy, atr, avg_volume, stdev


class SqueezeBreakout(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.bb_period = int(self.params.get("bb_period", 20))
        self.k_bb = float(self.params.get("k_bb", 2.0))
        self.k_kc = float(self.params.get("k_kc", 1.5))
        self.atr_period = int(self.params.get("atr_period", 16))     # reused for Keltner width
        self.lookback = int(self.params.get("lookback", 20))         # Donchian high
        self.squeeze_lookback = int(self.params.get("squeeze_lookback", 6))
        self.vol_period = int(self.params.get("vol_period", 32))
        self.vol_mult = float(self.params.get("vol_mult", 1.2))
        self.buffer = float(self.params.get("buffer", 0.002))
        self.max_chase = float(self.params.get("max_chase", 0.02))
        self.min_atr_frac = float(self.params.get("min_atr_frac", 0.005))
        self.expected_move = float(self.params.get("expected_move_pct", 0.03))
        self.min_candles = max(self.lookback + 1, self.bb_period + 1,
                               self.atr_period + 1, self.vol_period + 1,
                               self.regime_period + 1, 2)

    def _squeeze_on(self, candles: list[dict], closes: list[float]) -> bool:
        """True when the Bollinger half-width sits INSIDE the Keltner half-width (compression)."""
        sd = stdev(closes, self.bb_period)
        a = atr(candles, self.atr_period)
        if sd is None or a is None:
            return False
        return self.k_bb * sd < self.k_kc * a

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        price = closes[-1]
        a = atr(candles, self.atr_period)
        if a is None or a < self.min_atr_frac * price:                 # vol floor: skip dead tape
            return "HOLD"
        # squeeze must have fired within the recent window (compression precedes expansion)
        was_squeezed = any(
            self._squeeze_on(candles[:len(candles) - j], closes[:len(closes) - j])
            for j in range(1, self.squeeze_lookback + 1)
        )
        if not was_squeezed:
            return "HOLD"
        highs = [c["high"] for c in candles]
        window_high = max(highs[-self.lookback - 1:-1])                # prior N-bar high, excl current
        if window_high <= 0:
            return "HOLD"
        if price < window_high * (1 + self.buffer):                    # break + buffer
            return "HOLD"
        if price > window_high * (1 + self.max_chase):                 # chase cap
            return "HOLD"
        av = avg_volume(candles[:-1], self.vol_period)
        if av is None or candles[-1]["volume"] < self.vol_mult * av:   # participation
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: one BUY, one near-miss (thin volume), one too-few."""
    def candle(close, high, vol):
        return {"open": close, "high": high, "low": close - (high - close),
                "close": close, "volume": vol, "time": 0}

    params = {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 16, "lookback": 20,
              "squeeze_lookback": 6, "vol_period": 32, "vol_mult": 1.2, "buffer": 0.002,
              "max_chase": 0.02, "min_atr_frac": 0.005, "regime_period": 10,
              "expected_move_pct": 0.03}
    s = SqueezeBreakout("t", "M", params)

    # Coil: gentle uptrend in CLOSE (low stdev) but a real intrabar range (ATR up) -> squeeze ON.
    # close drifts 99.0 -> 100.0 over 50 bars; each bar has ~1.0 of range (ATR ~1% > 0.5% floor).
    coil = [candle(99.0 + i * 0.02, 99.0 + i * 0.02 + 0.5, 1.0) for i in range(50)]
    prior_high = max(c["high"] for c in coil[-20:])     # ~100.5
    # breakout bar: close clears the prior high + buffer, within chase cap, on a volume spike.
    brk = candle(prior_high * 1.005, prior_high * 1.01, 3.0)
    buy = coil + [brk]
    assert s.decide(buy) == "BUY", f"expected BUY, got {s.decide(buy)}"

    # near-miss: identical breakout but thin volume -> fails participation
    thin = coil + [candle(prior_high * 1.005, prior_high * 1.01, 1.0)]
    assert s.decide(thin) == "HOLD", f"expected HOLD, got {s.decide(thin)}"

    # too-few candles
    assert s.decide(coil[:5]) == "HOLD"
    print("squeeze_breakout self-check OK")


if __name__ == "__main__":
    demo()
