"""Secondary market-data sources: fallback + cross-check for the primary candle feed.

WHY: every signal keys off one public candles endpoint. Two failure modes matter:
the endpoint goes DOWN (no/stale bars - the engine already HOLDs via candles.validate),
and the endpoint prints GARBAGE that passes structural validation (a plausible-looking
but wrong bar). This module adds an independent reference - Binance's public klines -
used two ways, both config-gated (config.yaml `engine.feeds`) and both fail-open:

  fallback    for B-*_USDT markets the Binance series is the SAME asset and quote, so
              when the primary feed is unusable the reference bars can substitute for
              one cycle (validated by the same integrity gate). INR pairs NEVER use
              fallback: no alternative INR venue exists, and driving an INR sleeve off
              USDT prices would be silently wrong.
  crosscheck  any market with a USDT twin (I-*_INR included) can have its last CLOSED
              bar's RETURN compared against the twin's return on the same UTC bar.
              Returns (close/open - 1) are quote-currency-free, so INR-vs-USDT price
              levels cancel and only the bar's shape is compared. A divergence beyond
              the configured threshold means one feed printed a bad bar (or the INR
              book dislocated) -> the engine HOLDs that market this cycle and alerts.

FAIL-OPEN is deliberate everywhere: if the reference host is unreachable or the bars
don't align, the primary feed stands. An outage of the *reference* must never strangle
the bot - the reference only ever vetoes, and only when it demonstrably disagrees.
"""
from __future__ import annotations

import logging
import re

import requests

log = logging.getLogger(__name__)

# data-api.binance.vision is Binance's official public market-data-only host (no auth,
# no account surface); api.binance.com is the fallback host for the same /api/v3 shape.
_HOSTS = ("https://data-api.binance.vision", "https://api.binance.com")
_IV = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
       "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w"}
_MARKET_RE = re.compile(r"^[BI]-([A-Z0-9]+)_(USDT|INR)$")
_TIMEOUT_S = 10.0


def binance_symbol(market: str) -> str | None:
    """CoinDCX market id -> the Binance USDT reference symbol (B-BTC_USDT and
    I-BTC_INR both map to BTCUSDT). None when the market has no USDT twin."""
    m = _MARKET_RE.match(market)
    if not m:
        return None
    base = m.group(1)
    if base == "USDT":  # e.g. I-USDT_INR has no meaningful USDT twin
        return None
    return f"{base}USDT"


def can_substitute(market: str) -> bool:
    """Fallback bars are only valid when they are the SAME asset and quote."""
    return bool(_MARKET_RE.match(market)) and market.startswith("B-") \
        and market.endswith("_USDT")


def fetch_reference(market: str, interval: str, limit: int,
                    timeout: float = _TIMEOUT_S) -> list[dict]:
    """Binance klines for the market's USDT twin, mapped to the bot's candle dicts,
    oldest-first. Empty list on ANY problem (fail-open is the caller's contract)."""
    sym, iv = binance_symbol(market), _IV.get(interval)
    if not sym or not iv:
        return []
    params = {"symbol": sym, "interval": iv, "limit": max(1, min(int(limit), 1000))}
    for host in _HOSTS:
        try:
            r = requests.get(f"{host}/api/v3/klines", params=params, timeout=timeout)
            if r.status_code != 200:
                continue
            data = r.json()
            if not isinstance(data, list):
                continue
            return [{"time": int(k[0]), "open": float(k[1]), "high": float(k[2]),
                     "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                    for k in data if isinstance(k, (list, tuple)) and len(k) >= 6]
        except Exception:  # noqa: BLE001 - reference fetch must never raise to the engine
            log.debug("reference klines fetch failed on %s for %s", host, market)
            continue
    return []


def crosscheck_divergence(primary: list[dict], reference: list[dict]) -> tuple[float, int] | None:
    """Compare the last CLOSED primary bar's return against the reference bar with the
    SAME open-time. Returns (divergence in percentage points, bar open-time ms), or
    None when the series can't be compared (too short / no aligned bar) - the caller
    fails open on None. The last element of `primary` is assumed in-progress (engine
    convention), so the closed bar is primary[-2]."""
    if len(primary) < 2 or not reference:
        return None
    closed = primary[-2]
    t = int(closed["time"])
    ref = next((b for b in reversed(reference) if int(b["time"]) == t), None)
    if ref is None or not ref["open"] or not closed["open"]:
        return None
    p_ret = closed["close"] / closed["open"] - 1.0
    r_ret = ref["close"] / ref["open"] - 1.0
    return (abs(p_ret - r_ret) * 100.0, t)


def poll_delay(base_s: float, fast_s: float, fast_window_s: float,
               interval_ms: int, now_s: float) -> float:
    """Adaptive poll cadence: poll at `fast_s` for the first `fast_window_s` seconds
    after each bar-close boundary (the only stretch where a fresh closed bar can be
    waiting), `base_s` the rest of the time. Signals are unchanged - entries and exits
    still key off closed bars only - this just cuts the latency between a bar closing
    and the engine acting on it. Pure function so the schedule is unit-testable."""
    if fast_s <= 0 or fast_s >= base_s or fast_window_s <= 0:
        return base_s
    since_boundary = now_s % (interval_ms / 1000.0)
    return fast_s if since_boundary <= fast_window_s else base_s


def demo() -> None:
    # symbol mapping
    assert binance_symbol("I-BTC_INR") == "BTCUSDT"
    assert binance_symbol("B-ETH_USDT") == "ETHUSDT"
    assert binance_symbol("I-USDT_INR") is None
    assert binance_symbol("BTCINR") is None
    # substitution rule: same asset+quote only
    assert can_substitute("B-BTC_USDT") and not can_substitute("I-BTC_INR")

    def bars(vals, t0=0, step=86_400_000):
        return [{"time": t0 + i * step, "open": o, "high": max(o, c), "low": min(o, c),
                 "close": c, "volume": 1.0} for i, (o, c) in enumerate(vals)]

    # aligned bars, 2% vs 1% bar return -> 1.0 percentage point divergence
    p = bars([(100, 101), (100, 102), (102, 103)])   # last is in-progress
    r = bars([(50, 50.2), (50, 50.5), (50.5, 51)])
    d = crosscheck_divergence(p, r)
    assert d is not None and abs(d[0] - 1.0) < 1e-9 and d[1] == 86_400_000, d
    # no aligned timestamp -> None (fail open)
    assert crosscheck_divergence(p, bars([(50, 51)], t0=999)) is None
    assert crosscheck_divergence(p[:1], r) is None

    # adaptive poll: fast right after the boundary, base later, base when disabled
    day_ms = 86_400_000
    assert poll_delay(300, 60, 1800, day_ms, now_s=86_400 * 3 + 100) == 60
    assert poll_delay(300, 60, 1800, day_ms, now_s=86_400 * 3 + 7200) == 300
    assert poll_delay(300, 0, 1800, day_ms, now_s=100) == 300
    assert poll_delay(300, 400, 1800, day_ms, now_s=100) == 300
    print("feeds self-checks OK")


if __name__ == "__main__":
    demo()
