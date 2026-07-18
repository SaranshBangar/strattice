"""Symmetric long/short Donchian breakout (v8 research module).

STATUS: RESEARCH-ONLY (July 2026 v8 long/short study). Emits "SHORT"/"COVER"
tokens that only bot/backtest.py understands (run(allow_short=True)); the LIVE
engine acts on exact "BUY"/"SELL" matches only, so on the spot bot this module
degrades to a long-only Donchian and can never place a short order. Shorting
needs a derivatives venue, which this bot deliberately does not touch.

Hypothesis — the classic symmetric trend expression: go long when the close
breaks the prior `lookback`-bar high, go short when it breaks the prior
lookback low. No long-only regime gate: the short side IS the down-regime
expression. Exits are the protective layer (hard stop / optional target /
chandelier, mirrored for shorts by the backtester); an opposite-side breakout
flips the position. `buffer` demands the break clear the channel edge by a
fraction, filtering exact-touch noise.
"""
from .base import Strategy


class DonchianLS(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.lookback = int(self.params.get("lookback", 20))
        self.buffer = float(self.params.get("buffer", 0.002))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = self.lookback + 2

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        prior = candles[-self.lookback - 1:-1]      # channel from the PRIOR lookback bars
        hi = max(c["high"] for c in prior)
        lo = min(c["low"] for c in prior)
        close = candles[-1]["close"]
        if close > hi * (1 + self.buffer) and self._clears(self.expected_move):
            return "BUY"
        if close < lo * (1 - self.buffer) and self._clears(self.expected_move):
            return "SHORT"
        return "HOLD"


def demo() -> None:
    """Assert-based self-check: BUY over the channel high, SHORT under the low, HOLD inside."""
    def candles(closes):
        return [{"open": c, "high": c * 1.004, "low": c * 0.996, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    s = DonchianLS("d", "M", {"lookback": 10, "buffer": 0.002, "expected_move_pct": 0.08})
    base = [100.0] * 15
    assert s.decide(candles(base + [106.0])) == "BUY"      # breaks the prior high
    assert s.decide(candles(base + [94.0])) == "SHORT"     # breaks the prior low
    assert s.decide(candles(base + [100.2])) == "HOLD"     # inside the channel
    assert s.decide(candles(base[:5])) == "HOLD"           # too few bars
    print("donchian_ls self-check OK")


if __name__ == "__main__":
    demo()
