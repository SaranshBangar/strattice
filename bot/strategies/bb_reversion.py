"""Bollinger-band mean-reversion, ENTRY-ONLY. Aggressive sibling to `rsi` (item 4). A long
fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the PRIOR bar was a DEEP dislocation: it closed at/below its lower Bollinger band by at
    least z_entry sigma (a >= 2-sigma stretch, not a shallow wobble),
  - the CURRENT bar SNAPS BACK inside the band (close > the current lower band) — we buy the
    reversion, not the falling knife, and
  - the expected move clears modeled friction (item 7).
Exits are owned by the engine/backtest protective layer (take_profit_pct + stop_loss_pct +
max_hold_bars time-stop), NOT a band-touch flip — so this strategy never emits SELL.
NOTE: every sell pays 1% TDS, so clears_costs()'s 0.67% gate is NOT the real breakeven (~1.5-1.7%
round trip). That is why the config pairs this with TP 4% / SL 3% and a time-stop, and why win
rate must clear ~64% in backtest before it is enabled.
"""
from .base import Strategy, sma, stdev


class BBReversion(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 20))
        self.k = float(self.params.get("k", 2.0))
        self.z_entry = float(self.params.get("z_entry", 2.0))
        self.expected_move = float(self.params.get("expected_move_pct", 0.03))
        self.min_candles = max(self.period + 1, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        closes = [c["close"] for c in candles]
        mid, sd = sma(closes, self.period), stdev(closes, self.period)
        prev_mid, prev_sd = sma(closes[:-1], self.period), stdev(closes[:-1], self.period)
        if None in (mid, sd, prev_mid, prev_sd) or sd <= 0 or prev_sd <= 0:
            return "HOLD"
        lower = mid - self.k * sd
        prev_lower = prev_mid - self.k * prev_sd
        # prior bar: a >= z_entry-sigma stretch that closed at/below its lower band
        prev_close = closes[-2]
        if not (prev_close <= prev_lower and (prev_mid - prev_close) / prev_sd >= self.z_entry):
            return "HOLD"
        # current bar: snapped back inside the band (don't catch the knife)
        if closes[-1] <= lower:
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: one BUY, one near-miss (no snap-back), one too-few."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 900_000} for i, c in enumerate(closes)]

    params = {"period": 20, "k": 2.0, "z_entry": 2.0, "regime_period": 10,
              "expected_move_pct": 0.03}
    s = BBReversion("t", "M", params)

    # Long sustained climb (so price >> regime SMA), then a deep ~3-sigma drop on the prior bar,
    # then a partial snap-back inside the band on the current bar.
    climb = [100 + i * 0.5 for i in range(60)]   # 100 .. 129.5, low recent stdev (~2.9 over 20)
    top = climb[-1]
    dip = top - 12.0                              # deep dislocation (prior bar) -> > 2 sigma below band
    snap = top - 2.0                              # snaps back inside the band, still > regime SMA
    buy = candles(climb + [dip, snap])
    assert s.decide(buy) == "BUY", f"expected BUY, got {s.decide(buy)}"

    # near-miss: no snap-back (current bar keeps falling, stays below the band)
    nosnap = candles(climb + [dip, dip - 1.0])
    assert s.decide(nosnap) == "HOLD", f"expected HOLD, got {s.decide(nosnap)}"

    # too-few candles
    assert s.decide(candles(climb[:5])) == "HOLD"
    print("bb_reversion self-check OK")


if __name__ == "__main__":
    demo()
