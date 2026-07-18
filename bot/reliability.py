"""Reliability + security primitives for every external call the bot makes.

One place for the guard rails that keep a flaky network, a rate-limiting exchange, or a
skewed clock from turning into bad trades or leaked secrets:

  scrub()          redact API keys/secrets/tokens from any string before it reaches a log
                   line, an exception message, or a Telegram alert.
  TokenBucket      client-side rate limiter so the bot can NEVER hammer the exchange,
                   whatever bug is looping above it.
  CircuitBreaker   repeated timeouts/5xx open the circuit: calls fail fast (no hammering),
                   an alert fires once, and probes resume with exponential backoff.
  retry_idempotent bounded retries with exponential backoff + FULL JITTER for GET-style
                   (idempotent) calls only; honors 429 Retry-After. Order POSTs are never
                   retried here - idempotency of orders is the executor's client_order_id.
  ClockGuard       warns (and past a hard limit, halts signed calls) when the local clock
                   drifts from the exchange's - HMAC timestamps live and die by this.

Everything is dependency-injected (clock, sleep, rng) so bot/test_reliability.py covers
each behavior deterministically with no network and no real sleeping.
"""
from __future__ import annotations

import email.utils
import hmac
import logging
import random
import threading
import time

log = logging.getLogger("reliability")

# ---------------------------------------------------------------------------
# secret scrubbing
# ---------------------------------------------------------------------------

_MIN_SECRET_LEN = 8  # never register short strings: scrubbing "a" would shred every message


class _SecretRegistry:
    def __init__(self) -> None:
        self._secrets: set[str] = set()
        self._lock = threading.Lock()

    def register(self, *values: str | None) -> None:
        with self._lock:
            for v in values:
                if v and len(v) >= _MIN_SECRET_LEN:
                    self._secrets.add(v)

    def scrub(self, text: str) -> str:
        out = str(text)
        with self._lock:
            secrets = list(self._secrets)
        for s in secrets:
            if s in out:
                out = out.replace(s, "[REDACTED]")
        return out


_registry = _SecretRegistry()


def register_secrets(*values: str | None) -> None:
    """Register values (API keys, secrets, tokens) that must never appear in logs,
    exception messages, or alerts. Call once at import/startup for each credential."""
    _registry.register(*values)


def scrub(text: str) -> str:
    """Redact every registered secret from `text`. Safe on any input (str()'d first)."""
    return _registry.scrub(text)


def consteq(a: str | bytes, b: str | bytes) -> bool:
    """Constant-time equality for signatures/keys - use this, never ==, when comparing
    any secret-derived value so the comparison can't leak via timing."""
    if isinstance(a, str):
        a = a.encode()
    if isinstance(b, str):
        b = b.encode()
    return hmac.compare_digest(a, b)


# ---------------------------------------------------------------------------
# token-bucket rate limiter
# ---------------------------------------------------------------------------


class TokenBucket:
    """Client-side request budget. acquire() blocks (bounded) until a token is free, so
    a runaway loop upstream degrades into slow polling instead of an API ban.

    capacity   = burst size; refill_rate = sustained requests/second.
    CoinDCX's public guidance is coarse; defaults are far below any plausible limit."""

    def __init__(self, capacity: float = 8, refill_rate: float = 4,
                 clock=time.monotonic, sleeper=time.sleep):
        self.capacity = float(capacity)
        self.refill_rate = float(refill_rate)
        self._tokens = float(capacity)
        self._clock = clock
        self._sleep = sleeper
        self._last = clock()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.refill_rate)
        self._last = now

    def try_acquire(self, n: float = 1.0) -> bool:
        with self._lock:
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False

    def acquire(self, n: float = 1.0, max_wait: float = 30.0) -> bool:
        """Take n tokens, sleeping until available. False if max_wait would be exceeded
        (caller should treat that as a transient failure, not force the call through)."""
        deadline = self._clock() + max_wait
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= n:
                    self._tokens -= n
                    return True
                need = (n - self._tokens) / self.refill_rate if self.refill_rate > 0 else max_wait
            if self._clock() + need > deadline:
                return False
            self._sleep(min(need, 0.5))


# ---------------------------------------------------------------------------
# circuit breaker
# ---------------------------------------------------------------------------


class CircuitOpen(Exception):
    """Raised when a call is refused because the circuit is open (failing fast)."""


class CircuitBreaker:
    """Count consecutive transient failures; at `threshold` the circuit OPENS: calls fail
    fast (CircuitOpen) for `cooldown` seconds, then ONE probe is allowed through
    (half-open). Probe success closes the circuit; failure re-opens it with the cooldown
    doubled (capped at max_cooldown). `on_open`/`on_close` fire once per transition so the
    caller can alert without spamming."""

    def __init__(self, name: str = "", threshold: int = 5, cooldown: float = 30.0,
                 max_cooldown: float = 900.0, clock=time.monotonic,
                 on_open=None, on_close=None):
        self.name = name
        self.threshold = int(threshold)
        self.base_cooldown = float(cooldown)
        self.max_cooldown = float(max_cooldown)
        self._clock = clock
        self._on_open = on_open
        self._on_close = on_close
        self._lock = threading.Lock()
        self._failures = 0
        self._state = "closed"            # closed | open | half_open
        self._cooldown = float(cooldown)
        self._opened_at = 0.0
        self._was_open = False            # tripped at least once since last close (for on_close)

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    def allow(self) -> bool:
        """True if a call may proceed now. In the open state, becomes True once per
        cooldown expiry (the half-open probe)."""
        with self._lock:
            if self._state == "closed":
                return True
            if self._state == "open" and self._clock() - self._opened_at >= self._cooldown:
                self._state = "half_open"
                return True
            return self._state == "half_open"

    def before_call(self) -> None:
        """Raise CircuitOpen when calls must fail fast. Call at the top of every guarded call."""
        if not self.allow():
            with self._lock:
                wait = max(0.0, self._cooldown - (self._clock() - self._opened_at))
            raise CircuitOpen(f"{self.name or 'circuit'} open; retry in ~{wait:.0f}s")

    def record_success(self) -> None:
        with self._lock:
            was_open = self._was_open
            self._failures = 0
            self._state = "closed"
            self._cooldown = self.base_cooldown
            self._was_open = False
        if was_open and self._on_close:
            try:
                self._on_close(self.name)
            except Exception:  # noqa: BLE001 - notification must not break the call path
                log.exception("circuit on_close callback failed")

    def record_failure(self) -> None:
        notify_open = False
        with self._lock:
            self._failures += 1
            if self._state == "half_open":
                # probe failed -> reopen with doubled cooldown
                self._state = "open"
                self._opened_at = self._clock()
                self._cooldown = min(self._cooldown * 2, self.max_cooldown)
            elif self._state == "closed" and self._failures >= self.threshold:
                self._state = "open"
                self._opened_at = self._clock()
                self._cooldown = self.base_cooldown
                notify_open = True
                self._was_open = True
        if notify_open and self._on_open:
            try:
                self._on_open(self.name, self._cooldown)
            except Exception:  # noqa: BLE001
                log.exception("circuit on_open callback failed")


# ---------------------------------------------------------------------------
# retries with exponential backoff + full jitter (idempotent calls only)
# ---------------------------------------------------------------------------


def retry_after_seconds(headers: dict, default: float = 1.0) -> float:
    """Parse a Retry-After header (seconds or HTTP-date). `default` if absent/garbage."""
    v = None
    for k, val in (headers or {}).items():
        if str(k).lower() == "retry-after":
            v = val
            break
    if v is None:
        return default
    try:
        return max(0.0, float(v))
    except (TypeError, ValueError):
        pass
    try:
        dt = email.utils.parsedate_to_datetime(str(v))
        return max(0.0, dt.timestamp() - time.time())
    except Exception:  # noqa: BLE001 - a malformed header must not crash the retry path
        return default


class TransientHTTPError(Exception):
    """A retryable failure (timeout, connection error, 5xx, 429). Carries an optional
    server-directed wait (Retry-After)."""

    def __init__(self, msg: str, wait: float | None = None):
        super().__init__(msg)
        self.wait = wait


def retry_idempotent(fn, *, attempts: int = 4, base_delay: float = 0.5,
                     max_delay: float = 30.0, sleeper=time.sleep,
                     rng=random.random, breaker: CircuitBreaker | None = None):
    """Run `fn()` with bounded retries. ONLY for idempotent calls (GETs): callers must
    never route an order-placing POST through this.

    Backoff is exponential with FULL jitter (delay = U(0, base*2^i)), the standard cure
    for retry stampedes. A TransientHTTPError carrying `wait` (from 429 Retry-After) uses
    the server's number instead. Any other exception propagates immediately (not
    retryable). The optional breaker records success/failure and fails fast when open."""
    last: Exception | None = None
    for i in range(attempts):
        if breaker is not None:
            breaker.before_call()
        try:
            result = fn()
        except TransientHTTPError as e:
            last = e
            if breaker is not None:
                breaker.record_failure()
            if i == attempts - 1:
                break
            if e.wait is not None:
                delay = min(e.wait, max_delay)
            else:
                delay = min(base_delay * (2 ** i), max_delay) * rng()
            sleeper(delay)
        else:
            if breaker is not None:
                breaker.record_success()
            return result
    raise last  # type: ignore[misc]


# ---------------------------------------------------------------------------
# clock drift guard
# ---------------------------------------------------------------------------


class ClockGuard:
    """HMAC-signed requests carry a local-clock timestamp the exchange validates; a
    skewed clock silently breaks every private call (or worse, produces signatures an
    attacker's replay window loves). Measure drift against the exchange's own HTTP Date
    header (cheap: it rides on responses we already make), warn past `warn_s`, and HALT
    signed calls past `halt_s` - trading on a broken clock is trading blind.

    Drift is remeasured at most every `ttl` seconds; between measurements the last
    verdict stands. If drift was never measured (no response seen yet), signed calls
    proceed - the guard fails open on missing data but CLOSED on measured bad data."""

    def __init__(self, warn_s: float = 2.0, halt_s: float = 30.0, ttl: float = 300.0,
                 clock=time.time, monotonic=time.monotonic):
        self.warn_s = float(warn_s)
        self.halt_s = float(halt_s)
        self.ttl = float(ttl)
        self._clock = clock
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._drift: float | None = None
        self._measured_at: float | None = None
        self._warned = False

    def observe_date_header(self, headers: dict) -> None:
        """Feed the Date header from any fresh exchange response. HTTP Date has 1s
        granularity, so drift below ~2s is noise - that's why warn_s defaults to 2."""
        v = None
        for k, val in (headers or {}).items():
            if str(k).lower() == "date":
                v = val
                break
        if not v:
            return
        try:
            server = email.utils.parsedate_to_datetime(str(v)).timestamp()
        except Exception:  # noqa: BLE001 - a malformed Date must not break the caller
            return
        drift = self._clock() - server
        with self._lock:
            self._drift = drift
            self._measured_at = self._monotonic()
        if abs(drift) >= self.warn_s and not self._warned:
            self._warned = True
            log.warning("CLOCK DRIFT: local clock is %.1fs %s exchange time. Signed "
                        "requests may fail; fix NTP sync. (halts at %.0fs)",
                        abs(drift), "ahead of" if drift > 0 else "behind", self.halt_s)
        elif abs(drift) < self.warn_s:
            self._warned = False

    def drift(self) -> float | None:
        with self._lock:
            if self._measured_at is None:
                return None
            if self._monotonic() - self._measured_at > self.ttl:
                return None  # stale measurement - treat as unknown
            return self._drift

    def check_signed_ok(self) -> None:
        """Raise RuntimeError if the measured drift exceeds the halt threshold."""
        d = self.drift()
        if d is not None and abs(d) >= self.halt_s:
            raise RuntimeError(
                f"CLOCK_DRIFT_HALT: local clock is {abs(d):.1f}s "
                f"{'ahead of' if d > 0 else 'behind'} exchange time (limit {self.halt_s:.0f}s); "
                "refusing to sign requests until the clock is fixed (check NTP)")
