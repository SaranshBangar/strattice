"""Ichimoku Kumo breakout, long-only. The classic Japanese trend system: the cloud
(kumo) spanned by Senkou A/B — both projected `kijun_period` bars forward — acts as a
volatility-weighted support/resistance zone; trading above the cloud is the definition
of an uptrend. Long logic, exit part of the edge:
  - BUY  when the close breaks above the cloud top FRESHLY (was not above it
    `confirm_bars` ago), with tenkan > kijun (short-term momentum agrees) and the
    lagging-span check (close above the close of kijun_period bars ago — chikou free),
  - SELL when the close drops below the kijun line (the standard long-exit line;
    faster than waiting for the cloud floor),
  - HOLD otherwise.
Standard periods 9/26/52. The cloud at bar i is computed from data ending at bar
i - kijun_period (the forward projection), so there is no lookahead anywhere.
"""
from .base import Strategy


def _mid(candles: list[dict], n: int) -> float | None:
    """Midpoint of the highest high / lowest low of the last n bars."""
    if len(candles) < n:
        return None
    w = candles[-n:]
    return (max(c["high"] for c in w) + min(c["low"] for c in w)) / 2.0


def cloud_top_at(candles: list[dict], shift: int, tenkan_p: int, kijun_p: int,
                 senkou_b_p: int) -> float | None:
    """Cloud top ACTIVE at bar -1-shift: senkou A/B computed kijun_p bars earlier."""
    hist = candles[:len(candles) - shift - kijun_p] if shift + kijun_p else candles[:-kijun_p]
    if not hist:
        return None
    tenkan, kijun, sb = _mid(hist, tenkan_p), _mid(hist, kijun_p), _mid(hist, senkou_b_p)
    if tenkan is None or kijun is None or sb is None:
        return None
    return max((tenkan + kijun) / 2.0, sb)


class IchimokuBreakout(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.tenkan_p = int(self.params.get("tenkan", 9))
        self.kijun_p = int(self.params.get("kijun", 26))
        self.senkou_b_p = int(self.params.get("senkou_b", 52))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.senkou_b_p + self.kijun_p + self.confirm_bars + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        price = closes[-1]
        kijun = _mid(candles, self.kijun_p)
        if kijun is None:
            return "HOLD"
        if price < kijun:                                        # long-exit line broken
            return "SELL"
        top_now = cloud_top_at(candles, 0, self.tenkan_p, self.kijun_p, self.senkou_b_p)
        if top_now is None or price <= top_now:
            return "HOLD"
        # fresh breakout: close was NOT above the then-active cloud confirm_bars ago
        then = closes[-1 - self.confirm_bars]
        top_then = cloud_top_at(candles, self.confirm_bars, self.tenkan_p, self.kijun_p,
                                self.senkou_b_p)
        if top_then is not None and then > top_then:
            return "HOLD"                                        # stale — already above
        tenkan = _mid(candles, self.tenkan_p)
        if tenkan is None or tenkan <= kijun:                    # momentum must agree
            return "HOLD"
        if price <= closes[-1 - self.kijun_p]:                   # chikou span free
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY on a fresh cloud break, SELL under kijun, stale HOLD."""
    def candles(closes):
        return [{"open": c, "high": c * 1.005, "low": c * 0.995, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"tenkan": 5, "kijun": 10, "senkou_b": 20, "confirm_bars": 3,
              "expected_move_pct": 0.08}
    s = IchimokuBreakout("t", "M", params)

    # climb, deep dip through the cloud, then a sharp recovery: the close re-breaks the
    # cloud top FRESHLY with tenkan back above kijun -> BUY
    climb = [100 * (1.01 ** i) for i in range(35)]
    dip = [climb[-1] * (0.975 ** j) for j in range(1, 9)]
    recover = [dip[-1] * (1.04 ** j) for j in range(1, 6)]
    assert s.decide(candles(climb + dip + recover)) == "BUY", \
        s.decide(candles(climb + dip + recover))

    # long steady climb: above the cloud for ages -> stale -> HOLD
    steady = [100 * (1.01 ** i) for i in range(60)]
    assert s.decide(candles(steady)) == "HOLD"

    # mid-dip: close under the kijun -> SELL
    assert s.decide(candles(climb + dip)) == "SELL"

    assert s.decide(candles(climb[:10])) == "HOLD"               # too few
    print("ichimoku self-check OK")


if __name__ == "__main__":
    demo()
