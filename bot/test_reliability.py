"""Deterministic unit tests for bot/reliability.py + the client/notify wiring around it.

No network, no real sleeping: clock/sleep/rng are injected. Run:

    python -m bot.test_reliability
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from .reliability import (
    CircuitBreaker,
    CircuitOpen,
    ClockGuard,
    TokenBucket,
    TransientHTTPError,
    consteq,
    register_secrets,
    retry_after_seconds,
    retry_idempotent,
    scrub,
)


class FakeClock:
    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def test_scrub() -> None:
    register_secrets("supersecretapikey123", "another-secret-value", None, "")
    assert "supersecretapikey123" not in scrub("error: key=supersecretapikey123 rejected")
    assert "[REDACTED]" in scrub("key=supersecretapikey123")
    assert scrub("no secrets here") == "no secrets here"
    # short strings must NOT be registered (would shred every message)
    register_secrets("ab")
    assert scrub("ab absolutely") == "ab absolutely"
    # multiple occurrences all redacted
    s = scrub("supersecretapikey123 and again supersecretapikey123")
    assert "supersecretapikey123" not in s and s.count("[REDACTED]") == 2


def test_consteq() -> None:
    assert consteq("abc", "abc")
    assert not consteq("abc", "abd")
    assert consteq(b"xy", "xy")


def test_token_bucket() -> None:
    clk = FakeClock()
    sleeps: list[float] = []

    def sleeper(d):
        sleeps.append(d)
        clk.advance(d)

    tb = TokenBucket(capacity=3, refill_rate=1, clock=clk, sleeper=sleeper)
    # burst up to capacity, then empty
    assert tb.try_acquire() and tb.try_acquire() and tb.try_acquire()
    assert not tb.try_acquire()
    # refill over time
    clk.advance(2.0)
    assert tb.try_acquire() and tb.try_acquire()
    assert not tb.try_acquire()
    # blocking acquire waits for refill via sleeper
    assert tb.acquire(1, max_wait=5.0)
    assert sleeps, "acquire should have slept for the refill"
    # an impossible wait returns False instead of blocking forever
    tb2 = TokenBucket(capacity=1, refill_rate=0.001, clock=clk, sleeper=sleeper)
    assert tb2.try_acquire()
    assert not tb2.acquire(1, max_wait=1.0)


def test_circuit_breaker() -> None:
    clk = FakeClock()
    opened: list[tuple[str, float]] = []
    closed: list[str] = []
    cb = CircuitBreaker(name="t", threshold=3, cooldown=10, max_cooldown=35, clock=clk,
                        on_open=lambda n, c: opened.append((n, c)),
                        on_close=lambda n: closed.append(n))
    # below threshold: stays closed
    cb.record_failure()
    cb.record_failure()
    assert cb.state == "closed" and cb.allow()
    # threshold reached: opens once, alerts once
    cb.record_failure()
    assert cb.state == "open" and opened == [("t", 10)]
    try:
        cb.before_call()
        raise AssertionError("open circuit must fail fast")
    except CircuitOpen:
        pass
    # cooldown expiry -> half-open probe allowed
    clk.advance(10.1)
    assert cb.allow() and cb.state == "half_open"
    # probe failure -> reopen with doubled cooldown (no new on_open alert)
    cb.record_failure()
    assert cb.state == "open" and len(opened) == 1
    clk.advance(10.1)
    assert not cb.allow(), "doubled cooldown (20s) must not expire after 10s"
    clk.advance(10.1)
    assert cb.allow()
    # probe failure again -> cooldown doubles but caps at max_cooldown (35)
    cb.record_failure()
    clk.advance(34.9)
    assert not cb.allow()
    clk.advance(0.2)
    assert cb.allow()
    # probe success -> closes, on_close fires once, cooldown resets
    cb.record_success()
    assert cb.state == "closed" and closed == ["t"]
    # success in never-opened state must not fire on_close
    cb.record_success()
    assert closed == ["t"]


def test_retry_idempotent() -> None:
    sleeps: list[float] = []
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise TransientHTTPError("boom")
        return "ok"

    out = retry_idempotent(flaky, attempts=4, base_delay=1.0,
                           sleeper=sleeps.append, rng=lambda: 1.0)
    assert out == "ok" and calls["n"] == 3
    assert sleeps == [1.0, 2.0], "exponential backoff with rng=1.0 (full jitter upper bound)"

    # jitter: rng scales the delay
    sleeps.clear()
    calls["n"] = 0
    retry_idempotent(flaky, attempts=4, base_delay=1.0, sleeper=sleeps.append, rng=lambda: 0.5)
    assert sleeps == [0.5, 1.0]

    # Retry-After (TransientHTTPError.wait) overrides the backoff schedule
    sleeps.clear()
    calls["n"] = 0

    def limited():
        calls["n"] += 1
        if calls["n"] == 1:
            raise TransientHTTPError("429", wait=7.5)
        return "ok"

    retry_idempotent(limited, attempts=3, sleeper=sleeps.append, rng=lambda: 1.0)
    assert sleeps == [7.5]

    # exhausted attempts -> last transient error propagates
    def always():
        raise TransientHTTPError("down")

    try:
        retry_idempotent(always, attempts=2, sleeper=lambda d: None)
        raise AssertionError("must raise after exhausting attempts")
    except TransientHTTPError:
        pass

    # a NON-transient error propagates immediately (no retry)
    calls["n"] = 0

    def fatal():
        calls["n"] += 1
        raise ValueError("bad params")

    try:
        retry_idempotent(fatal, attempts=4, sleeper=lambda d: None)
        raise AssertionError("non-transient must propagate")
    except ValueError:
        pass
    assert calls["n"] == 1, "non-transient errors must not be retried"

    # breaker integration: failures count, open circuit fails fast
    cb = CircuitBreaker(threshold=2, cooldown=60, clock=FakeClock())
    try:
        retry_idempotent(always, attempts=5, sleeper=lambda d: None, breaker=cb)
    except (TransientHTTPError, CircuitOpen):
        pass
    assert cb.state == "open", "repeated failures through retry must open the breaker"


def test_retry_after_seconds() -> None:
    assert retry_after_seconds({"Retry-After": "3"}) == 3.0
    assert retry_after_seconds({"retry-after": "0"}) == 0.0
    assert retry_after_seconds({}, default=2.0) == 2.0
    assert retry_after_seconds({"Retry-After": "garbage"}, default=1.5) == 1.5
    # HTTP-date form parses to a non-negative wait
    assert retry_after_seconds({"Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT"}) == 0.0


def test_clock_guard() -> None:
    wall = FakeClock(1_700_000_000.0)
    mono = FakeClock(0.0)
    cg = ClockGuard(warn_s=2.0, halt_s=30.0, ttl=300.0, clock=wall, monotonic=mono)
    # never measured -> unknown drift, signed calls proceed (fail open on missing data)
    assert cg.drift() is None
    cg.check_signed_ok()

    def hdr(offset: float) -> dict:
        from email.utils import formatdate
        return {"Date": formatdate(wall.t - offset, usegmt=True)}

    # small drift: recorded, no halt
    cg.observe_date_header(hdr(1.0))
    assert abs(cg.drift() - 1.0) < 1.1
    cg.check_signed_ok()
    # big drift: halts signed calls
    cg.observe_date_header(hdr(45.0))
    try:
        cg.check_signed_ok()
        raise AssertionError("45s drift must halt signed calls")
    except RuntimeError as e:
        assert "CLOCK_DRIFT_HALT" in str(e)
    # stale measurement -> unknown again -> proceeds
    mono.advance(301.0)
    assert cg.drift() is None
    cg.check_signed_ok()
    # malformed/absent Date header never crashes
    cg.observe_date_header({"Date": "not a date"})
    cg.observe_date_header({})


def test_client_error_scrubbed() -> None:
    from .client import CoinDCXError
    register_secrets("hunter2hunter2hunter2")
    e = CoinDCXError("401 /exchange/v1/orders/create: bad key hunter2hunter2hunter2")
    assert "hunter2hunter2hunter2" not in str(e) and "[REDACTED]" in str(e)


def test_notify_spool(tmp: Path) -> None:
    """A failed Telegram send spools to disk; the next successful send flushes it."""
    from . import config, notify

    old_db = config.DB_PATH
    config.DB_PATH = tmp / "bot.db"
    posted: list[str] = []
    old_post = notify._post_telegram
    try:
        # outage: every post fails -> messages spool
        notify._post_telegram = lambda msg: False
        notify._send_sync("alert one")
        notify._send_sync("alert two")
        spool = notify._spool_path()
        assert spool.exists() and len(spool.read_text().splitlines()) == 2

        # recovery: posts succeed -> live message + spooled backlog all delivered
        notify._post_telegram = lambda msg: posted.append(msg) or True
        orig_sleep = notify.time.sleep
        notify.time.sleep = lambda s: None
        try:
            notify._send_sync("alert three")
        finally:
            notify.time.sleep = orig_sleep
        assert posted[0] == "alert three"
        assert any("alert one" in m and "[delayed" in m for m in posted)
        assert any("alert two" in m for m in posted)
        assert not spool.exists(), "flushed spool must be removed"

        # bounded: never keeps more than _SPOOL_MAX_LINES
        notify._post_telegram = lambda msg: False
        for i in range(notify._SPOOL_MAX_LINES + 25):
            notify._spool_append(f"m{i}")
        lines = notify._spool_path().read_text().splitlines()
        assert len(lines) == notify._SPOOL_MAX_LINES
        assert "m24" not in lines[0], "oldest overflow must be dropped"
    finally:
        notify._post_telegram = old_post
        config.DB_PATH = old_db


def main() -> None:
    test_scrub()
    test_consteq()
    test_token_bucket()
    test_circuit_breaker()
    test_retry_idempotent()
    test_retry_after_seconds()
    test_clock_guard()
    test_client_error_scrubbed()
    with tempfile.TemporaryDirectory(prefix="notify_spool_") as d:
        test_notify_spool(Path(d))
    print("reliability self-checks OK "
          f"(pid {os.getpid()}: scrub, consteq, token bucket, circuit breaker, retry+jitter, "
          "retry-after, clock guard, error scrubbing, alert spool)")


if __name__ == "__main__":
    main()
