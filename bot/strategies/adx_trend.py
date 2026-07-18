"""ADX/DMI trend entry, ENTRY-ONLY. Wilder's directional-movement system: +DI / -DI
measure up- vs down-directional pressure and ADX measures how STRONG the directional
move is regardless of side. The classic filter finding: directional crosses are noise
unless ADX confirms a real trend. A long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - +DI is above -DI and the cross happened within the last confirm_bars (fresh),
  - ADX >= min_adx (the trend has actual strength — the anti-chop filter), and
  - the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — this
module never emits SELL. Wilder smoothing throughout, O(window) per decide().
"""
from .base import Strategy


def dmi_series(candles: list[dict], n: int) -> tuple[list[float], list[float], list[float]]:
    """Per-bar (+DI, -DI, ADX) with Wilder smoothing; zeros while warming up."""
    m = len(candles)
    plus_di, minus_di, adx = [0.0] * m, [0.0] * m, [0.0] * m
    if m < 2:
        return plus_di, minus_di, adx
    str_, spdm, smdm = 0.0, 0.0, 0.0     # smoothed TR / +DM / -DM
    dxs: list[float] = []
    adx_val = 0.0
    for i in range(1, m):
        h, l = candles[i]["high"], candles[i]["low"]
        ph, pl, pc = candles[i - 1]["high"], candles[i - 1]["low"], candles[i - 1]["close"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        up, dn = h - ph, pl - l
        pdm = up if up > dn and up > 0 else 0.0
        mdm = dn if dn > up and dn > 0 else 0.0
        if i <= n:                        # accumulate the first n bars
            str_, spdm, smdm = str_ + tr, spdm + pdm, smdm + mdm
            if i < n:
                continue
        else:                             # Wilder smoothing thereafter
            str_ = str_ - str_ / n + tr
            spdm = spdm - spdm / n + pdm
            smdm = smdm - smdm / n + mdm
        if str_ <= 0:
            continue
        pdi, mdi = 100.0 * spdm / str_, 100.0 * smdm / str_
        plus_di[i], minus_di[i] = pdi, mdi
        s = pdi + mdi
        dxs.append(100.0 * abs(pdi - mdi) / s if s > 0 else 0.0)
        if len(dxs) == n:
            adx_val = sum(dxs) / n
        elif len(dxs) > n:
            adx_val = (adx_val * (n - 1) + dxs[-1]) / n
        adx[i] = adx_val if len(dxs) >= n else 0.0
    return plus_di, minus_di, adx


class AdxTrend(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.period = int(self.params.get("period", 14))
        self.min_adx = float(self.params.get("min_adx", 20.0))
        self.confirm_bars = int(self.params.get("confirm_bars", 3))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(3 * self.period + self.confirm_bars + 2,
                               self.regime_period + 1, 2)
        # Wilder smoothing is recursive, so compute DMI over a FIXED-length trailing slice:
        # decisions are identical for any window >= trunc bars (bounded-window/live parity).
        self.trunc = self.min_candles + 200

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        candles = candles[-self.trunc:]
        if not self._uptrend(candles):
            return "HOLD"
        pdi, mdi, adx = dmi_series(candles, self.period)
        if pdi[-1] <= mdi[-1] or adx[-1] < self.min_adx:
            return "HOLD"
        # fresh cross: -DI was on top somewhere within the last confirm_bars bars
        recent = range(len(candles) - 1 - self.confirm_bars, len(candles) - 1)
        if not any(pdi[j] <= mdi[j] for j in recent):
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY on a fresh strong +DI cross, HOLD when stale or weak."""
    def candles(closes):
        return [{"open": c, "high": c * 1.01, "low": c * 0.99, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"period": 5, "min_adx": 15, "confirm_bars": 3, "regime_period": 10,
              "expected_move_pct": 0.08}
    s = AdxTrend("t", "M", params)

    # long climb: +DI on top for ages -> cross is STALE -> HOLD
    climb = [100 * (1.012 ** i) for i in range(50)]
    assert s.decide(candles(climb)) == "HOLD"

    # decline then a sharp V-recovery: -DI was on top, fresh +DI cross with strength -> BUY
    top = 100 * 1.012 ** 30
    seq = ([100 * (1.012 ** i) for i in range(30)]
           + [top * (0.985 ** j) for j in range(1, 7)]
           + [top * 0.985 ** 6 * (1.035 ** j) for j in range(1, 3)])
    assert s.decide(candles(seq)) == "BUY", s.decide(candles(seq))

    assert s.decide(candles(climb[:8])) == "HOLD"                # too few
    print("adx_trend self-check OK")


if __name__ == "__main__":
    demo()
