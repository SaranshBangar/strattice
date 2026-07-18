"""v8 feed-layer tests: reference fallback, cross-check veto, fail-open, memoization,
and the adaptive poll schedule. The reference fetch is STUBBED throughout - no network.

Run: python -m bot.test_feeds
"""
import tempfile
import time as _time
from pathlib import Path

from . import feeds
from .test_fallbacks import _fresh_world

DAY = 86_400_000


def _healthy_bars(n: int = 400, price: float = 100.0) -> list[dict]:
    now = int(_time.time() * 1000)
    start = now - (n - 1) * DAY
    out, px = [], price
    for i in range(n):
        px *= 1.01
        out.append({"time": start + i * DAY, "open": px, "high": px * 1.01,
                    "low": px * 0.99, "close": px, "volume": 10.0})
    return out


def _with_feeds(eng, *, fallback: bool, crosscheck_pct: float) -> None:
    eng.feed_fallback = fallback
    eng.feed_crosscheck_pct = crosscheck_pct
    eng._crosschecked = {}


def test_crosscheck_vetoes_bad_print(tmp: Path) -> None:
    """A closed bar whose return wildly disagrees with the USDT twin -> HOLD + alert."""
    from . import notify
    eng, fake = _fresh_world(tmp)
    _with_feeds(eng, fallback=False, crosscheck_pct=10.0)
    bars = _healthy_bars(400)
    # corrupt the last CLOSED bar into a +60% print that still passes OHLC validation
    bad = dict(bars[-2])
    bad["close"] = bad["open"] * 1.6
    bad["high"] = bad["close"] * 1.01
    bars[-2] = bad
    fake.candles_data = bars
    # reference agrees with the ORIGINAL tape (~+1%/bar) -> ~59pp divergence
    ref = [{"time": b["time"], "open": b["open"], "high": b["high"], "low": b["low"],
            "close": b["open"] * 1.01, "volume": 1.0} for b in bars[-5:]]
    calls: list = []
    orig_fetch, orig_send = feeds.fetch_reference, notify.send
    sent: list[str] = []
    feeds.fetch_reference = lambda *a, **k: calls.append(a) or ref
    notify.send = lambda m: sent.append(m)
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw)
    try:
        eng.run_once()
        assert not placed, "diverged bar must place nothing"
        assert any("Bad candle data" in m for m in sent), "veto must alert"
    finally:
        feeds.fetch_reference, notify.send = orig_fetch, orig_send


def test_crosscheck_pass_and_memoization(tmp: Path) -> None:
    """An agreeing reference lets the trade through, and the same closed bar is only
    cross-checked once (the reference host is not polled every cycle)."""
    eng, fake = _fresh_world(tmp)
    _with_feeds(eng, fallback=False, crosscheck_pct=10.0)
    bars = _healthy_bars(400)
    fake.candles_data = bars
    ref = [dict(b) for b in bars[-5:]]           # identical returns -> 0 divergence
    calls: list = []
    orig_fetch = feeds.fetch_reference
    feeds.fetch_reference = lambda *a, **k: calls.append(a) or ref
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw) or {"status": "dry_run"}
    try:
        eng.run_once()
        assert placed and placed[0]["side"] == "buy", "agreeing reference must not block"
        n = len(calls)
        assert n >= 1
        eng.run_once()
        assert len(calls) == n, "same closed bar must not be re-cross-checked"
    finally:
        feeds.fetch_reference = orig_fetch


def test_crosscheck_fails_open(tmp: Path) -> None:
    """Reference unreachable (empty) -> the primary feed stands and trades proceed."""
    eng, fake = _fresh_world(tmp)
    _with_feeds(eng, fallback=False, crosscheck_pct=10.0)
    fake.candles_data = _healthy_bars(400)
    orig_fetch = feeds.fetch_reference
    feeds.fetch_reference = lambda *a, **k: []
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw) or {"status": "dry_run"}
    try:
        eng.run_once()
        assert placed, "reference outage must never strangle the bot"
    finally:
        feeds.fetch_reference = orig_fetch


def test_fallback_substitutes_usdt_only(tmp: Path) -> None:
    """A dead primary feed is substituted from the reference for B-*_USDT markets and
    NEVER for INR markets (different venue/quote would be silently wrong)."""
    eng, fake = _fresh_world(tmp)
    _with_feeds(eng, fallback=True, crosscheck_pct=0.0)
    fake.candles_data = []                        # primary feed down
    good = _healthy_bars(400)
    orig_fetch = feeds.fetch_reference
    feeds.fetch_reference = lambda *a, **k: good
    try:
        assert eng._validated_candles("B-ETH_USDT") is not None, \
            "USDT market must substitute the reference bars"
        assert eng._validated_candles("I-ETH_INR") is None, \
            "INR market must NEVER trade off the USDT reference"
        # fallback disabled -> even the USDT market holds
        eng.feed_fallback = False
        assert eng._validated_candles("B-ETH_USDT") is None
    finally:
        feeds.fetch_reference = orig_fetch


def main() -> None:
    feeds.demo()  # pure-function checks (symbol map, divergence math, poll schedule)
    for fn in (test_crosscheck_vetoes_bad_print, test_crosscheck_pass_and_memoization,
               test_crosscheck_fails_open, test_fallback_substitutes_usdt_only):
        with tempfile.TemporaryDirectory(prefix="feeds_") as d:
            fn(Path(d))
    print("feed-layer self-checks OK: crosscheck veto/pass/memoize/fail-open, "
          "USDT-only fallback, adaptive poll schedule")


if __name__ == "__main__":
    main()
