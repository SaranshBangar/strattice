"""Thin CoinDCX REST client. HMAC-SHA256 signed private calls; public candles/markets.

Signing: signature = HMAC_SHA256(secret, exact_json_body); body MUST include 'timestamp' (ms).
The exact byte string that is signed is the exact byte string that is POSTed.
"""
import hashlib
import hmac
import json
import logging
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import config

log = logging.getLogger(__name__)

API = "https://api.coindcx.com"
PUBLIC = "https://public.coindcx.com"


class CoinDCXError(Exception):
    pass


def _retrying_session() -> requests.Session:
    """Session that retries transient upstream failures with backoff. Retry's default
    allowed_methods excludes POST, so signed order calls are never double-fired."""
    s = requests.Session()
    retry = Retry(
        total=4, backoff_factor=0.5,  # 0.5,1,2,4s between tries
        status_forcelist=(429, 502, 503, 504), raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    return s


_BALANCE_CACHE_TTL = 3.0  # seconds - collapses the handful of free_balance() calls a single
                          # trade decision makes (sizing.equity/free_balance x risk.check) into
                          # one real signed HTTP call, while staying fresh enough between decisions

# CoinDCX's public candles endpoint returns at most ~1000 bars per request. Multi-year
# history is stitched from sized backward windows (see Client.candles).
MAX_CANDLES_PER_REQ = 1000

_INTERVAL_UNIT_MS = {"m": 60_000, "h": 3_600_000, "d": 86_400_000, "w": 604_800_000}


def _interval_ms(interval: str) -> int:
    """Milliseconds per bar for a CoinDCX interval like '15m', '1h', '1d', '1w'.
    Raises ValueError for unsupported units (e.g. '1M' month) so pagination never
    silently mis-sizes a window."""
    # Case-sensitive: CoinDCX uses 'm' for minute and 'M' for month, so never lowercase.
    interval = interval.strip()
    unit = interval[-1:]
    if unit not in _INTERVAL_UNIT_MS:
        raise ValueError(f"unsupported candle interval for pagination: {interval!r}")
    try:
        n = int(interval[:-1])
    except ValueError as e:
        raise ValueError(f"unsupported candle interval for pagination: {interval!r}") from e
    if n <= 0:
        raise ValueError(f"unsupported candle interval for pagination: {interval!r}")
    return n * _INTERVAL_UNIT_MS[unit]


class Client:
    def __init__(self, key: str = config.API_KEY, secret: str = config.SECRET_KEY):
        self.key = key
        self.secret = secret.encode()
        self._markets: dict | None = None
        self._http = _retrying_session()
        self._balance_cache: dict[str, tuple[float, float]] = {}  # currency -> (value, fetched_at)

    # ---------- public ----------
    def _candles_page(self, pair: str, interval: str, limit: int,
                      end_time: int | None = None) -> list[dict]:
        """One candles request (<= MAX_CANDLES_PER_REQ bars), oldest-first. When end_time is
        given, a matching startTime is sent too: the endpoint ignores endTime unless a
        startTime bounds the window (verified against the live API)."""
        params: dict = {"pair": pair, "interval": interval, "limit": limit}
        if end_time is not None:
            params["endTime"] = end_time
            params["startTime"] = end_time - limit * _interval_ms(interval)
        r = self._http.get(f"{PUBLIC}/market_data/candles", params=params, timeout=20)
        r.raise_for_status()
        # CoinDCX public API intermittently returns 200 with an empty/non-JSON body;
        # treat as a transient blip and skip this poll cycle rather than crashing.
        text = r.text.strip()
        if not text:
            log.warning("empty candles response for %s %s; skipping cycle", pair, interval)
            return []
        try:
            data = r.json()
        except ValueError:
            log.warning("non-JSON candles response for %s %s: %.80r; skipping cycle",
                        pair, interval, text)
            return []
        if not isinstance(data, list):
            # e.g. an error object {"message": ...} when the params are rejected
            log.warning("unexpected candles payload for %s %s: %.120r; skipping cycle",
                        pair, interval, data)
            return []
        return list(reversed(data))  # oldest-first for strategy math

    def candles(self, pair: str, interval: str, limit: int = 200,
                since_ms: int | None = None) -> list[dict]:
        """Oldest-first {open,high,low,close,volume,time(ms)} bars.

        CoinDCX caps a single request at ~1000 bars, so multi-year history is stitched from
        sized backward windows. Pass `since_ms` (epoch ms) to fetch every bar since that
        instant; otherwise the newest `limit` bars are returned (paginated when limit > 1000).
        The hot live-poll path (small limit, no since_ms) stays a single request."""
        if since_ms is None and limit <= MAX_CANDLES_PER_REQ:
            return self._candles_page(pair, interval, limit)

        step = _interval_ms(interval)
        collected: dict[int, dict] = {}  # ts -> bar, dedups overlapping windows
        end: int | None = None           # None = newest page; then walk backward
        # Safety bound so a misbehaving endpoint can't loop forever (>15y of daily bars).
        for i in range(64):
            page = self._candles_page(pair, interval, MAX_CANDLES_PER_REQ, end_time=end)
            if not page:
                break
            for b in page:
                collected[b["time"]] = b
            oldest = page[0]["time"]  # oldest-first page -> first element is oldest
            enough = since_ms is not None and oldest <= since_ms
            enough = enough or (since_ms is None and len(collected) >= limit)
            if enough:
                break
            new_end = oldest - step
            if end is not None and new_end >= end:
                break  # no backward progress -> stop
            if len(page) < MAX_CANDLES_PER_REQ and end is not None:
                break  # window fell before the listing date -> history exhausted
            end = new_end
            time.sleep(0.2)  # be gentle on the public endpoint across paginated requests
        bars = sorted(collected.values(), key=lambda b: b["time"])
        if since_ms is not None:
            return [b for b in bars if b["time"] >= since_ms]
        return bars[-limit:] if limit else bars

    def markets(self) -> dict:
        if self._markets is None:
            r = self._http.get(f"{API}/exchange/v1/markets_details", timeout=20)
            r.raise_for_status()
            self._markets = {m["pair"]: m for m in r.json()}
        return self._markets

    def round_qty(self, pair: str, qty: float) -> float:
        m = self.markets().get(pair)
        if not m:
            return qty
        prec = int(m.get("target_currency_precision", 8))
        return round(qty, prec)

    def min_quantity(self, pair: str) -> float:
        m = self.markets().get(pair)
        return float(m["min_quantity"]) if m else 0.0

    def min_notional(self, pair: str) -> float:
        """Exchange min order value in quote currency. markets_details exposes this as
        'min_notional' (quote min); 0.0 if the pair/field is absent."""
        m = self.markets().get(pair)
        if not m:
            return 0.0
        return float(m.get("min_notional", 0.0) or 0.0)

    # ---------- private (signed) ----------
    def _signed(self, path: str, payload: dict) -> dict:
        if not self.key or not self.secret:
            raise CoinDCXError("API credentials not configured")
        payload = {**payload, "timestamp": int(time.time() * 1000)}
        body = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-AUTH-APIKEY": self.key,
            "X-AUTH-SIGNATURE": sig,
        }
        r = self._http.post(f"{API}{path}", data=body, headers=headers, timeout=20)
        if r.status_code >= 400:
            raise CoinDCXError(f"{r.status_code} {path}: {r.text}")
        return r.json()

    def _order_market(self, pair: str) -> str:
        """orders/create + cancel want CoinDCX's `coindcx_name` (e.g. BTCINR), NOT the
        `pair` (I-BTC_INR) used everywhere else. Translate via markets_details; fall back
        to the pair unchanged if it's not found (already a coindcx_name, or markets down)."""
        m = self.markets().get(pair)
        return m.get("coindcx_name", pair) if m else pair

    def create_order(self, *, market: str, side: str, qty: float,
                     order_type: str = "market_order", price: float | None = None,
                     client_order_id: str | None = None) -> dict:
        payload = {
            "market": self._order_market(market), "side": side, "order_type": order_type,
            "total_quantity": qty,
        }
        if price is not None:
            payload["price_per_unit"] = price
        if client_order_id:
            payload["client_order_id"] = client_order_id
        return self._signed("/exchange/v1/orders/create", payload)

    def cancel_all(self, market: str | None = None) -> dict:
        return self._signed(
            "/exchange/v1/orders/cancel_all",
            {"market": self._order_market(market)} if market else {},
        )

    def balances(self) -> dict:
        return self._signed("/exchange/v1/users/balances", {})

    def free_balance(self, currency: str = "USDT") -> float:
        """Available (non-locked) balance for a currency. 0.0 if not held.

        Short-TTL cached: a single trade decision calls this indirectly up to 4 times
        (sizing.equity/free_balance, each called again from risk.check()) — collapsing
        those into one signed HTTP call within the TTL window is safe because
        invalidate_balance_cache() is called right after any fill actually changes it."""
        now = time.monotonic()
        cached = self._balance_cache.get(currency)
        if cached is not None and now - cached[1] < _BALANCE_CACHE_TTL:
            return cached[0]
        value = 0.0
        for b in self.balances():
            if b.get("currency") == currency:
                value = float(b.get("balance", 0.0) or 0.0)
                break
        self._balance_cache[currency] = (value, now)
        return value

    def invalidate_balance_cache(self) -> None:
        """Call right after a fill that changes the wallet, so the next read is fresh."""
        self._balance_cache.clear()
