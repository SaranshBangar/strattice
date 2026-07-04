"""User-built rule strategy, ENTRY-ONLY. Interprets the rule JSON that the platform's
strategy builder stores in user_strategies.params (schema v1):

    {"v": 1, "name": "...", "rules": [{"kind": ..., ...}, ...],
     "exits": {"stop_loss_pct": ..., ...}}

ALL rules must be true on the current bar to BUY. Exits are handled by the engine's
shared protective layer (config_gen maps the def's "exits" onto the strategy spec) -
this module never emits SELL. The evaluator MUST stay in lockstep with the web preview
(platform/web/lib/custom-strategy.ts) so what users see while building is what trades.

Defensive by construction: an unknown rule kind, missing field, or too-little history
evaluates to False -> HOLD. A malformed def can never throw out of decide().
"""
from __future__ import annotations

from .base import Strategy, atr, avg_volume, rsi, sma, stdev

SCHEMA_VERSION = 1


def _f(rule: dict, key: str, default: float = 0.0) -> float:
    try:
        return float(rule.get(key, default))
    except (TypeError, ValueError):
        return default


def _i(rule: dict, key: str, default: int = 0) -> int:
    return int(_f(rule, key, default))


class CustomRules(Strategy):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        rules = self.params.get("rules")
        self.rules: list[dict] = [r for r in rules if isinstance(r, dict)] if isinstance(rules, list) else []
        # warm-up: the longest integer window any rule uses (mirror of customWarmup in TS)
        warm = 2
        for r in self.rules:
            for key in ("period", "fast", "slow", "within", "lookback"):
                if key in r:
                    warm = max(warm, _i(r, key) + 1)
        self.min_candles = warm

    # -- one rule on the last bar; unknown/short-history -> False --------------------
    def _rule_ok(self, rule: dict, candles: list[dict], closes: list[float]) -> bool:
        kind = rule.get("kind")
        if kind == "trend":
            m = sma(closes, _i(rule, "period", 96))
            if m is None:
                return False
            return closes[-1] > m if rule.get("op", "above") == "above" else closes[-1] < m
        if kind == "sma_cross":
            fast, slow, within = _i(rule, "fast", 20), _i(rule, "slow", 50), _i(rule, "within", 3)
            for j in range(within):
                n = len(closes) - j
                if n < 2:
                    break
                af, as_ = sma(closes[:n], fast), sma(closes[:n], slow)
                bf, bs = sma(closes[:n - 1], fast), sma(closes[:n - 1], slow)
                if None not in (af, as_, bf, bs) and bf <= bs and af > as_:
                    return True
            return False
        if kind == "rsi":
            r = rsi(closes, _i(rule, "period", 14))
            if r is None:
                return False
            return r > _f(rule, "value", 30) if rule.get("op", "below") == "above" else r < _f(rule, "value", 30)
        if kind == "breakout":
            lookback = _i(rule, "lookback", 20)
            if len(candles) < lookback + 1:
                return False
            window_high = max(c["high"] for c in candles[-lookback - 1:-1])
            return window_high > 0 and closes[-1] >= window_high * (1 + _f(rule, "buffer", 0.2) / 100)
        if kind == "bollinger":
            period, k = _i(rule, "period", 20), _f(rule, "k", 2.0)
            mid, sd = sma(closes, period), stdev(closes, period)
            if mid is None or sd is None or sd <= 0:
                return False
            if rule.get("band", "below_lower") == "below_lower":
                return closes[-1] < mid - k * sd
            return closes[-1] > mid + k * sd
        if kind == "volume":
            av = avg_volume(candles[:-1], _i(rule, "period", 20))
            return av is not None and candles[-1]["volume"] >= _f(rule, "mult", 1.5) * av
        if kind == "volatility":
            a = atr(candles, _i(rule, "period", 14))
            if a is None or closes[-1] <= 0:
                return False
            frac, th = a / closes[-1], _f(rule, "value", 0.5) / 100
            return frac > th if rule.get("op", "above") == "above" else frac < th
        if kind == "change":
            lookback = _i(rule, "lookback", 10)
            if len(closes) < lookback + 1 or closes[-1 - lookback] <= 0:
                return False
            chg = (closes[-1] - closes[-1 - lookback]) / closes[-1 - lookback] * 100
            return chg > _f(rule, "value", 2) if rule.get("op", "above") == "above" else chg < _f(rule, "value", 2)
        if kind == "confirm":
            return len(candles) >= 2 and candles[-1]["close"] > candles[-2]["high"]
        return False  # unknown rule kind -> never enter

    def decide(self, candles: list[dict]) -> str:
        if not self.rules or len(candles) < self.min_candles:
            return "HOLD"
        closes = [c["close"] for c in candles]
        if all(self._rule_ok(r, candles, closes) for r in self.rules):
            return "BUY"
        return "HOLD"


def demo() -> None:
    """Assert-based self-check: BUY on a confirmed oversold dip in an uptrend; HOLD otherwise."""
    def candles(closes):
        return [{"open": c, "high": c, "low": c, "close": c, "volume": 1.0,
                 "time": i * 900_000} for i, c in enumerate(closes)]

    rules = [
        {"kind": "trend", "op": "above", "period": 40},
        {"kind": "rsi", "period": 7, "op": "below", "value": 35},
        {"kind": "confirm"},
    ]
    s = CustomRules("t", "M", {"rules": rules})

    # climb (uptrend) then a sharp multi-bar dip (RSI low) then a confirmed bounce
    climb = [100 + i for i in range(40)]          # ...139: well above SMA(20)
    dip = [135.0, 131.0, 127.0]                   # RSI(7) crushed
    bounce = [130.0]                              # closes above prior bar high (127)
    buy = candles(climb + dip + bounce)
    assert s.decide(buy) == "BUY", f"expected BUY, got {s.decide(buy)}"

    # no confirmation: still falling
    nobounce = candles(climb + dip + [126.0])
    assert s.decide(nobounce) == "HOLD"

    # unknown rule kind -> HOLD forever, never a crash
    weird = CustomRules("t", "M", {"rules": [{"kind": "astrology", "moon": "full"}]})
    assert weird.decide(buy) == "HOLD"

    # empty / malformed defs -> HOLD, no crash
    assert CustomRules("t", "M", {}).decide(buy) == "HOLD"
    assert CustomRules("t", "M", {"rules": "nope"}).decide(buy) == "HOLD"
    print("custom rules self-check OK")


if __name__ == "__main__":
    demo()
