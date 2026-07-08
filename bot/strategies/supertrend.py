"""Supertrend flip, ENTRY-ONLY. Classic ATR-band trend follower: ratcheting bands at
median-price +/- mult*ATR define an up/down trend state; a long fires only when:
  - the market is in an uptrend (shared regime gate, item 3),
  - the supertrend state FLIPPED to up within the last confirm_bars (fresh flip, so a
    chandelier exit mid-trend doesn't churn-rebuy every bar),
  - and the expected move clears modeled friction (item 7).
Exit is the engine/backtest protective layer (chandelier trail + hard stop) — this
module never emits SELL; the fat right tail of trend winners pays the ~1.5-1.7%
India round trip, exactly like the other daily trend engines.

The band arithmetic is the textbook ratchet: in an up state the lower band may only
rise, in a down state the upper band may only fall; state flips when the close breaks
the active band. Deterministic, O(window) per decide().
"""
from .base import Strategy


def _atr_series(candles: list[dict], n: int) -> list[float | None]:
    """Rolling simple-mean ATR (same TR + mean semantics as base.atr) per bar."""
    trs: list[float] = []
    out: list[float | None] = [None]  # bar 0 has no previous close
    for i in range(1, len(candles)):
        h, l, pc = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
        out.append(sum(trs[-n:]) / n if len(trs) >= n else None)
    return out


def supertrend_states(candles: list[dict], atr_period: int, mult: float) -> list[int]:
    """Per-bar trend state: +1 up, -1 down, 0 warming up. Standard ratcheting bands."""
    n = len(candles)
    atrs = _atr_series(candles, atr_period)
    states = [0] * n
    up_band = dn_band = None  # active lower (support) / upper (resistance) bands
    state = 0
    for i in range(n):
        a = atrs[i]
        if a is None:
            continue
        hl2 = (candles[i]["high"] + candles[i]["low"]) / 2.0
        basic_up = hl2 - mult * a   # support in an uptrend
        basic_dn = hl2 + mult * a   # resistance in a downtrend
        prev_close = candles[i - 1]["close"] if i else candles[i]["close"]
        # ratchet: support may only rise while price holds above it; resistance only falls
        up_band = basic_up if up_band is None or prev_close <= up_band else max(basic_up, up_band)
        dn_band = basic_dn if dn_band is None or prev_close >= dn_band else min(basic_dn, dn_band)
        close = candles[i]["close"]
        if state <= 0 and close > dn_band:
            state = 1
            up_band = basic_up          # re-seed the new support
        elif state >= 0 and state != 0 and close < up_band:
            state = -1
            dn_band = basic_dn          # re-seed the new resistance
        elif state == 0:
            state = 1 if close > dn_band else -1
        states[i] = state
    return states


class Supertrend(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.atr_period = int(self.params.get("atr_period", 10))
        self.mult = float(self.params.get("mult", 3.0))
        self.confirm_bars = int(self.params.get("confirm_bars", 2))
        self.expected_move = float(self.params.get("expected_move_pct", 0.08))
        self.min_candles = max(self.atr_period + 2, self.regime_period + 1, 2)

    def decide(self, candles: list[dict]) -> str:
        if len(candles) < self.min_candles:
            return "HOLD"
        if not self._uptrend(candles):
            return "HOLD"
        states = supertrend_states(candles, self.atr_period, self.mult)
        if states[-1] != 1:
            return "HOLD"
        # fresh flip: a non-up state within the last confirm_bars bars before now
        recent = states[-1 - self.confirm_bars:-1]
        if not recent or all(s == 1 for s in recent):
            return "HOLD"
        if not self._clears(self.expected_move):
            return "HOLD"
        return "BUY"


def demo() -> None:
    """Assert-based self-check: BUY right after a down->up flip, HOLD when stale/absent."""
    def candles(closes):
        return [{"open": c, "high": c * 1.01, "low": c * 0.99, "close": c, "volume": 1.0,
                 "time": i * 86_400_000} for i, c in enumerate(closes)]

    params = {"atr_period": 5, "mult": 1.5, "confirm_bars": 2, "regime_period": 10,
              "expected_move_pct": 0.08}
    s = Supertrend("t", "M", params)

    # long climb (uptrend + state up for ages) -> flip is STALE -> HOLD
    climb = [100 * (1.01 ** i) for i in range(40)]
    assert s.decide(candles(climb)) == "HOLD"

    # climb, sharp multi-bar drop (state flips down), then a strong V-recovery that
    # breaks the upper band while the regime SMA is still below price -> fresh flip BUY
    drop = [climb[-1] * f for f in (0.93, 0.87, 0.82)]
    recover = [drop[-1] * 1.06, drop[-1] * 1.18, drop[-1] * 1.30]
    seq = climb + drop + recover
    got = s.decide(candles(seq))
    states = supertrend_states(candles(seq), 5, 1.5)
    assert states[-1] == 1 and got == "BUY", (got, states[-6:])

    assert s.decide(candles(climb[:5])) == "HOLD"  # too few
    print("supertrend self-check OK")


if __name__ == "__main__":
    demo()
