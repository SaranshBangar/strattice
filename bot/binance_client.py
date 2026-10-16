"""Binance spot REST client with the SAME interface as bot.client.Client (CoinDCX).

The engine, executor, sizing, risk and reconcile layers only ever talk to that one
interface, so the bot trades Binance by swapping the client (bot.client.make_client
picks it from config.yaml `exchange:`). Market ids keep the bot's CoinDCX-style
spelling: "B-BTC_USDT" means Binance symbol BTCUSDT. Responses are normalized into the
shapes the rest of the bot already parses (CoinDCX-style markets_details fields, an
{"orders": [...]} create/status payload, {currency, balance, locked_balance} balances),
so no caller needs an exchange branch.

Reliability is the same layer the CoinDCX client uses (bot/reliability.py): timeouts on
every call, a client-side token bucket, retries with backoff+jitter for idempotent GETs
only (signed order POSTs are NEVER retried - the client_order_id idempotency key and
reconcile own recovery), a circuit breaker per host, the clock-drift guard, and secret
scrubbing on every error message.

Signing (Binance spec): HMAC-SHA256(secret, urlencoded query) appended as `signature`,
API key in the X-MBX-APIKEY header, `timestamp` (ms) + `recvWindow` on every signed call.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import re
import time
from urllib.parse import urlencode

import requests

from . import config
from .client import ExchangeError, MAX_CANDLES_PER_REQ, REQUEST_TIMEOUT, _interval_ms, \
    _breaker_alert_close, _breaker_alert_open
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

API = "https://api.binance.com"
# Public market data: Binance's official market-data-only mirror first (it is not
# geo-blocked the way api.binance.com answers 451 to some regions), then the main host.
PUBLIC_HOSTS = ("https://data-api.binance.vision", API)
RECV_WINDOW_MS = 5000
_MARKETS_TTL = 3600.0
_BALANCE_CACHE_TTL = 3.0
_MARKET_RE = re.compile(r"^B-([A-Z0-9]{1,15})_([A-Z0-9]{1,15})$")
# Binance order statuses -> the lowercase vocabulary bot/reconcile.py understands
_STATUS = {"FILLED": "filled", "PARTIALLY_FILLED": "partially_filled",
           "CANCELED": "cancelled", "PENDING_CANCEL": "open", "REJECTED": "rejected",
           "EXPIRED": "expired", "EXPIRED_IN_MATCH": "expired", "NEW": "open"}
# error codes that mean "the key/secret/permissions are wrong" (surfaced as 401)
AUTH_ERROR_CODES = {-2014, -2015, -1022}


class BinanceError(ExchangeError):
    """Binance API error. Message format "<http status> <path>: <body>", scrubbed."""


def symbol_of(pair: str) -> str:
    """"B-BTC_USDT" -> "BTCUSDT". A bare Binance symbol passes through unchanged."""
    m = _MARKET_RE.match(pair)
    return f"{m.group(1)}{m.group(2)}" if m else pair


def _decimals(step: str) -> int:
    """Decimal places of a Binance step/tick string ("0.00010000" -> 4)."""
    s = step.rstrip("0")
    return len(s.split(".", 1)[1]) if "." in s else 0


class BinanceClient:
    exchange = "binance"

    def __init__(self, key: str | None = None, secret: str | None = None):
        key = config.BINANCE_API_KEY if key is None else key
        secret = config.BINANCE_SECRET_KEY if secret is None else secret
        self.key = key
        self.secret = secret.encode()
        from . import reliability
        reliability.register_secrets(key, secret)
        self._markets: dict | None = None
        self._markets_at = 0.0
        self._http = requests.Session()
        self._balance_cache: dict[str, tuple[float, float]] = {}
        # Binance allows 6000 request-weight/min; 4 req/s sustained is far below that.
        self._bucket = TokenBucket(capacity=8, refill_rate=4)
        self._pub_breaker = CircuitBreaker(
            name="binance-public", threshold=5, cooldown=30, max_cooldown=900,
            on_open=_breaker_alert_open, on_close=_breaker_alert_close)
        self._api_breaker = CircuitBreaker(
            name="binance-api", threshold=5, cooldown=30, max_cooldown=900,
            on_open=_breaker_alert_open, on_close=_breaker_alert_close)
        self._clock_guard = ClockGuard(warn_s=2.0, halt_s=30.0)

    # ---------- transport ----------
    def _get(self, path: str, params: dict | None = None) -> requests.Response:
        def attempt() -> requests.Response:
            if not self._bucket.acquire():
                raise TransientHTTPError("rate limiter saturated (client-side)")
            r = None
            for host in PUBLIC_HOSTS:
                try:
                    r = self._http.get(f"{host}{path}", params=params,
                                       timeout=REQUEST_TIMEOUT)
                except (requests.Timeout, requests.ConnectionError) as e:
                    if host == PUBLIC_HOSTS[-1]:
                        raise TransientHTTPError(scrub(f"network error: {e}")) from e
                    continue
                if r.status_code not in (403, 451):  # region-blocked -> next host
                    break
            self._clock_guard.observe_date_header(r.headers)
            if r.status_code in (418, 429):
                raise TransientHTTPError(
                    f"{r.status_code} rate limited",
                    wait=retry_after_seconds(r.headers, default=2.0))
            if r.status_code >= 500:
                raise TransientHTTPError(f"{r.status_code} from {path}")
            return r

        return retry_idempotent(attempt, attempts=4, base_delay=0.5,
                                breaker=self._pub_breaker)

    def _signed(self, method: str, path: str, params: dict) -> dict | list:
        """One signed request. NEVER retried (see module docstring)."""
        if not self.key or not self.secret:
            raise BinanceError("API credentials not configured")
        self._clock_guard.check_signed_ok()
        self._api_breaker.before_call()
        if not self._bucket.acquire():
            self._api_breaker.record_failure()
            raise BinanceError("rate limiter saturated (client-side); not sending signed call")
        q = urlencode({**params, "recvWindow": RECV_WINDOW_MS,
                       "timestamp": int(time.time() * 1000)})
        sig = hmac.new(self.secret, q.encode(), hashlib.sha256).hexdigest()
        url = f"{API}{path}?{q}&signature={sig}"
        try:
            r = self._http.request(method, url, headers={"X-MBX-APIKEY": self.key},
                                   timeout=REQUEST_TIMEOUT)
        except (requests.Timeout, requests.ConnectionError) as e:
            self._api_breaker.record_failure()
            raise BinanceError(f"network error on {path}: {e}") from e
        self._clock_guard.observe_date_header(r.headers)
        if r.status_code in (418, 429) or r.status_code >= 500:
            self._api_breaker.record_failure()
            raise BinanceError(f"{r.status_code} {path}: {r.text}")
        self._api_breaker.record_success()
        if r.status_code >= 400:
            status = r.status_code
            try:
                if int(r.json().get("code", 0)) in AUTH_ERROR_CODES:
                    status = 401  # the supervisor keys "fix your API keys" off 401/403
            except (ValueError, AttributeError, TypeError):
                pass
            raise BinanceError(f"{status} {path}: {r.text}")
        return r.json()

    # ---------- public ----------
    def _klines(self, pair: str, interval: str, limit: int,
                start: int | None = None, end: int | None = None) -> list[dict]:
        params: dict = {"symbol": symbol_of(pair), "interval": interval,
                        "limit": max(1, min(int(limit), MAX_CANDLES_PER_REQ))}
        if start is not None:
            params["startTime"] = start
        if end is not None:
            params["endTime"] = end
        r = self._get("/api/v3/klines", params)
        if r.status_code != 200:
            log.warning("klines %s %s: HTTP %s %.120r; skipping cycle", pair, interval,
                        r.status_code, r.text)
            return []
        try:
            data = r.json()
        except ValueError:
            return []
        if not isinstance(data, list):
            return []
        return [{"time": int(k[0]), "open": float(k[1]), "high": float(k[2]),
                 "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                for k in data if isinstance(k, (list, tuple)) and len(k) >= 6]

    def candles(self, pair: str, interval: str, limit: int = 200,
                since_ms: int | None = None) -> list[dict]:
        """Oldest-first {open,high,low,close,volume,time(ms)} bars; the last bar is the
        in-progress one (same convention as the CoinDCX client - the engine drops it)."""
        if since_ms is None and limit <= MAX_CANDLES_PER_REQ:
            return self._klines(pair, interval, limit)
        step = _interval_ms(interval)
        collected: dict[int, dict] = {}
        if since_ms is not None:          # page forward from since_ms
            cursor = since_ms
            for _ in range(64):
                page = self._klines(pair, interval, MAX_CANDLES_PER_REQ, start=cursor)
                for b in page:
                    collected[b["time"]] = b
                if len(page) < MAX_CANDLES_PER_REQ:
                    break
                cursor = page[-1]["time"] + step
        else:                             # newest `limit` bars, paging backward
            end = None
            for _ in range(64):
                page = self._klines(pair, interval, MAX_CANDLES_PER_REQ, end=end)
                for b in page:
                    collected[b["time"]] = b
                if not page or len(collected) >= limit or len(page) < MAX_CANDLES_PER_REQ:
                    break
                end = page[0]["time"] - 1
        bars = sorted(collected.values(), key=lambda b: b["time"])
        if since_ms is not None:
            return [b for b in bars if b["time"] >= since_ms]
        return bars[-limit:] if limit else bars

    def markets(self) -> dict:
        """exchangeInfo keyed by the bot's pair id, with the CoinDCX markets_details field
        names the rest of the bot reads (precision, min qty/notional, base currency)."""
        now = time.monotonic()
        if self._markets is not None and now - self._markets_at < _MARKETS_TTL:
            return self._markets
        try:
            r = self._get("/api/v3/exchangeInfo")
            r.raise_for_status()
            out: dict = {}
            for s in r.json().get("symbols", []):
                if s.get("status") != "TRADING":
                    continue
                f = {x.get("filterType"): x for x in s.get("filters", [])}
                lot = f.get("LOT_SIZE", {})
                notional = f.get("NOTIONAL") or f.get("MIN_NOTIONAL") or {}
                pair = f"B-{s['baseAsset']}_{s['quoteAsset']}"
                out[pair] = {
                    "pair": pair, "symbol": s["symbol"],
                    "target_currency_short_name": s["baseAsset"],
                    "base_currency_short_name": s["quoteAsset"],
                    "target_currency_precision": _decimals(lot.get("stepSize", "0.00000001")),
                    "step_size": float(lot.get("stepSize", 0) or 0),
                    "min_quantity": float(lot.get("minQty", 0) or 0),
                    "min_notional": float(notional.get("minNotional", 0) or 0),
                }
            self._markets, self._markets_at = out, now
        except Exception:
            if self._markets is None:
                raise
            log.warning("exchangeInfo refresh failed; keeping cached copy")
        return self._markets

    def round_qty(self, pair: str, qty: float) -> float:
        """Floor to the pair's LOT_SIZE step: Binance rejects off-step quantities, and
        rounding UP could ask to sell more than the wallet holds."""
        m = self.markets().get(pair)
        if not m:
            return qty
        prec = int(m["target_currency_precision"])
        f = 10 ** prec
        return math.floor(qty * f + 1e-9) / f

    def min_quantity(self, pair: str) -> float:
        m = self.markets().get(pair)
        return float(m["min_quantity"]) if m else 0.0

    def min_notional(self, pair: str) -> float:
        m = self.markets().get(pair)
        return float(m.get("min_notional", 0.0) or 0.0) if m else 0.0

    # ---------- private (signed) ----------
    @staticmethod
    def _normalize_order(o: dict, base: str | None = None) -> dict:
        """Binance order JSON -> the {"orders": [...]} shape executor/reconcile parse.
        filled_quantity is NET of any commission charged in the base asset (Binance
        takes a BUY's fee out of the coins received unless BNB pays it), so the book
        never records more coins than the wallet actually holds."""
        executed = float(o.get("executedQty", 0) or 0)
        quote = float(o.get("cummulativeQuoteQty", 0) or 0)
        fee_in_base = sum(float(f.get("commission", 0) or 0) for f in o.get("fills", [])
                          if base and f.get("commissionAsset") == base)
        net = max(0.0, executed - fee_in_base) if o.get("side") == "BUY" else executed
        return {"orders": [{
            "id": o.get("orderId"),
            "client_order_id": o.get("clientOrderId"),
            "status": _STATUS.get(str(o.get("status", "")).upper(), "unknown"),
            "filled_quantity": net,
            "avg_price": (quote / executed) if executed > 0 else 0.0,
        }], "raw": o}

    def create_order(self, *, market: str, side: str, qty: float,
                     order_type: str = "market_order", price: float | None = None,
                     client_order_id: str | None = None) -> dict:
        params: dict = {"symbol": symbol_of(market), "side": side.upper(),
                        "newOrderRespType": "FULL"}
        if order_type == "market_order":
            params.update(type="MARKET", quantity=f"{qty:.8f}".rstrip("0").rstrip("."))
        else:
            params.update(type="LIMIT", timeInForce="GTC",
                          quantity=f"{qty:.8f}".rstrip("0").rstrip("."), price=price)
        if client_order_id:
            params["newClientOrderId"] = client_order_id
        resp = self._signed("POST", "/api/v3/order", params)
        base = (self.markets().get(market) or {}).get("target_currency_short_name")
        return self._normalize_order(resp, base)

    def order_status(self, *, client_order_id: str, market: str | None = None) -> dict | None:
        """Look up an order by our client_order_id (Binance needs the symbol too). None
        when Binance has no such order - the lost-confirmation POST never landed."""
        if not market:
            raise BinanceError("order_status needs the market on Binance")
        try:
            resp = self._signed("GET", "/api/v3/order", {
                "symbol": symbol_of(market), "origClientOrderId": client_order_id})
        except BinanceError as e:
            if "-2013" in str(e) or "does not exist" in str(e).lower():
                return None
            raise
        base = (self.markets().get(market) or {}).get("target_currency_short_name")
        return self._normalize_order(resp, base)

    def cancel_all(self, market: str | None = None) -> dict:
        """Cancel open orders on one market, or (market=None, the kill switch) on every
        symbol that has any - Binance's cancel endpoint is per-symbol."""
        if market:
            symbols = [symbol_of(market)]
        else:
            symbols = sorted({o["symbol"] for o in self._signed("GET", "/api/v3/openOrders", {})})
        done = []
        for sym in symbols:
            try:
                self._signed("DELETE", "/api/v3/openOrders", {"symbol": sym})
                done.append(sym)
            except BinanceError as e:
                if "-2011" not in str(e):  # "Unknown order sent" = nothing open there
                    raise
        return {"cancelled_symbols": done}

    def balances(self) -> list[dict]:
        acct = self._signed("GET", "/api/v3/account", {"omitZeroBalances": "true"})
        return [{"currency": b["asset"], "balance": float(b.get("free", 0) or 0),
                 "locked_balance": float(b.get("locked", 0) or 0)}
                for b in acct.get("balances", [])]

    def free_balance(self, currency: str = "USDT") -> float:
        now = time.monotonic()
        cached = self._balance_cache.get(currency)
        if cached is not None and now - cached[1] < _BALANCE_CACHE_TTL:
            return cached[0]
        value = 0.0
        for b in self.balances():
            if b["currency"] == currency:
                value = b["balance"]
                break
        self._balance_cache[currency] = (value, now)
        return value

    def invalidate_balance_cache(self) -> None:
        self._balance_cache.clear()
