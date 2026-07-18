"""Thin CoinDCX REST client. HMAC-SHA256 signed private calls; public candles/markets.

Signing: signature = HMAC_SHA256(secret, exact_json_body); body MUST include 'timestamp' (ms).
The exact byte string that is signed is the exact byte string that is POSTed.

Every external call is wrapped in the reliability layer (bot/reliability.py):
  - request timeouts on every call (nothing can hang the poll loop)
  - a token-bucket rate limiter so the bot can never hammer the exchange
  - bounded retries with exponential backoff + jitter for IDEMPOTENT (GET) calls only,
    honoring 429 Retry-After; signed POSTs are NEVER auto-retried so an order can't
    double-fire (the executor's client_order_id idempotency is the second lock)
  - a circuit breaker per host: repeated 5xx/timeouts fail fast + alert once, then
    probe with exponential backoff instead of hammering a struggling API
  - a clock-drift guard fed by exchange response Date headers: warns on small skew,
    refuses to sign requests past a hard limit (HMAC timestamps die by clock skew)
  - secrets registered with the scrubber so keys can never leak into exceptions/logs.
"""
import hashlib
import hmac
import json
import logging
import time

import requests

from . import config
from .reliability import (
    CircuitBreaker,
    ClockGuard,
    TokenBucket,
    TransientHTTPError,
    retry_after_seconds,
    retry_idempotent,
    scrub,
)

log = logging.getLogger(__name__)

API = "https://api.coindcx.com"
PUBLIC = "https://public.coindcx.com"

REQUEST_TIMEOUT = 20          # seconds, every HTTP call
_MARKETS_TTL = 3600.0         # re-fetch markets_details hourly so precision/min-notional
                              # changes on pairs are picked up without a restart


class CoinDCXError(Exception):
    """Exchange/API error. Message is always scrubbed of registered secrets."""

    def __init__(self, msg: str):
        super().__init__(scrub(msg))


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


def _breaker_alert_open(name: str, cooldown: float) -> None:
    # Local import: notify pulls config only, but keeping it lazy avoids any cycle if
    # notify ever needs client features.
    from . import notify
    notify.send(notify.bullets("API circuit breaker OPEN", [
        ("Host", name),
        ("Action", "pausing calls, will probe with backoff"),
        ("Cooldown", f"{cooldown:.0f}s"),
    ]))


def _breaker_alert_close(name: str) -> None:
    from . import notify
    notify.send(notify.bullets("API circuit breaker closed", [
        ("Host", name), ("Action", "calls resumed"),
    ]))


class Client:
    def __init__(self, key: str = config.API_KEY, secret: str = config.SECRET_KEY):
        self.key = key
        self.secret = secret.encode()
        from . import reliability
        reliability.register_secrets(key, secret)  # never in logs/exceptions/alerts
        self._markets: dict | None = None
        self._markets_at = 0.0
        self._http = requests.Session()
        self._balance_cache: dict[str, tuple[float, float]] = {}  # currency -> (value, fetched_at)
        # Shared budget for ALL calls this client makes (public + signed): 4 req/s
        # sustained, burst 8 - far under any plausible exchange limit, and enough for a
        # 7-sleeve poll cycle with room to spare.
        self._bucket = TokenBucket(capacity=8, refill_rate=4)
        self._pub_breaker = CircuitBreaker(
            name="coindcx-public", threshold=5, cooldown=30, max_cooldown=900,
            on_open=_breaker_alert_open, on_close=_breaker_alert_close)
        self._api_breaker = CircuitBreaker(
            name="coindcx-api", threshold=5, cooldown=30, max_cooldown=900,
            on_open=_breaker_alert_open, on_close=_breaker_alert_close)
        self._clock_guard = ClockGuard(warn_s=2.0, halt_s=30.0)

    # ---------- transport ----------
    def _get(self, url: str, *, params: dict | None = None,
             breaker: CircuitBreaker | None = None) -> requests.Response:
        """One idempotent GET: rate-limited, retried with backoff+jitter (429/5xx/timeouts),
        circuit-broken, and feeding the clock-drift guard from the response Date header."""
        breaker = breaker or self._pub_breaker

        def attempt() -> requests.Response:
            if not self._bucket.acquire():
                raise TransientHTTPError("rate limiter saturated (client-side)")
            try:
                r = self._http.get(url, params=params, timeout=REQUEST_TIMEOUT)
            except (requests.Timeout, requests.ConnectionError) as e:
                raise TransientHTTPError(scrub(f"network error: {e}")) from e
            self._clock_guard.observe_date_header(r.headers)
            if r.status_code == 429:
                raise TransientHTTPError(
                    "429 rate limited", wait=retry_after_seconds(r.headers, default=2.0))
            if r.status_code >= 500:
                raise TransientHTTPError(f"{r.status_code} from {url}")
            return r

        return retry_idempotent(attempt, attempts=4, base_delay=0.5, breaker=breaker)

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
        r = self._get(f"{PUBLIC}/market_data/candles", params=params)
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
        """markets_details keyed by pair. Cached with a TTL (not forever) so precision or
        min-notional changes on a pair are picked up within the hour instead of never.
        A refresh failure keeps serving the last good copy rather than erroring the caller."""
        now = time.monotonic()
        if self._markets is not None and now - self._markets_at < _MARKETS_TTL:
            return self._markets
        try:
            r = self._get(f"{API}/exchange/v1/markets_details")
            r.raise_for_status()
            self._markets = {m["pair"]: m for m in r.json()}
            self._markets_at = now
        except Exception:
            if self._markets is None:
                raise
            log.warning("markets_details refresh failed; keeping cached copy")
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
        """One signed POST. NEVER retried here: a network error after the exchange
        received the order would double-fire it. Recovery from a lost confirmation is the
        executor/reconcile job (client_order_id lookup), not a blind resend."""
        if not self.key or not self.secret:
            raise CoinDCXError("API credentials not configured")
        self._clock_guard.check_signed_ok()  # refuse to sign on a badly skewed clock
        self._api_breaker.before_call()
        if not self._bucket.acquire():
            self._api_breaker.record_failure()
            raise CoinDCXError("rate limiter saturated (client-side); not sending signed call")
        payload = {**payload, "timestamp": int(time.time() * 1000)}
        body = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(self.secret, body.encode(), hashlib.sha256).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-AUTH-APIKEY": self.key,
            "X-AUTH-SIGNATURE": sig,
        }
        try:
            r = self._http.post(f"{API}{path}", data=body, headers=headers,
                                timeout=REQUEST_TIMEOUT)
        except (requests.Timeout, requests.ConnectionError) as e:
            self._api_breaker.record_failure()
            # scrub() guards against a body/signature echo ever reaching logs or alerts
            raise CoinDCXError(f"network error on {path}: {e}") from e
        self._clock_guard.observe_date_header(r.headers)
        if r.status_code == 429 or r.status_code >= 500:
            self._api_breaker.record_failure()
            raise CoinDCXError(f"{r.status_code} {path}: {r.text}")
        self._api_breaker.record_success()
        if r.status_code >= 400:
            # 4xx = the request itself is wrong (auth, params, balance) - the API is healthy,
            # so it does not count against the breaker.
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

    def order_status(self, *, client_order_id: str) -> dict | None:
        """Look up an order by our own client_order_id. None if the exchange has no such
        order (i.e. a lost-confirmation POST never actually landed). Used by the boot
        reconciliation pass to heal bot.db after a crash mid-order."""
        try:
            return self._signed("/exchange/v1/orders/status",
                                {"client_order_id": client_order_id})
        except CoinDCXError as e:
            msg = str(e)
            # A 404/not-found means the order never reached the books - a definitive answer.
            if msg.startswith("404") or "not found" in msg.lower():
                return None
            raise

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
