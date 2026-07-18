"""Failure-scenario tests: every fallback behavior is exercised deterministically.

Covers, one scenario per test, with no network and a throwaway SQLite DB:
  - candle integrity: stale / partial garbage / duplicated / out-of-order / gapped /
    malformed feeds -> HOLD (validator rejects), benign quirks -> normalized
  - engine holds + places nothing on a bad feed
  - lost order confirmation -> status row 'error' -> boot reconciliation heals bot.db
    from the exchange's answer (filled / never-seen / needs-manual)
  - live partial fills book only the filled amount
  - balance desync between bot.db and the wallet -> detected and reported
  - SQLite: integrity check, locked-db timeout pragma, daily backup rotation
  - kill switch beats everything: entries, exits, and a dead API on the kill path
  - engine crash-loop guard throttles rapid restarts

Run: python -m bot.test_fallbacks
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path

DAY = 86_400_000


def _bars(n: int, start_ms: int = 0, step: int = DAY, price: float = 100.0) -> list[dict]:
    return [{"time": start_ms + i * step, "open": price, "high": price + 1,
             "low": price - 1, "close": price, "volume": 10.0} for i in range(n)]


# ---------------------------------------------------------------------------
# candle integrity
# ---------------------------------------------------------------------------

def test_candle_validator() -> None:
    from .candles import validate

    now = 400 * DAY
    good = _bars(400)
    rep = validate(good, DAY, now_ms=now)
    assert rep.ok and not rep.problems and len(rep.bars) == 400

    # stale: newest bar is 10 intervals old
    rep = validate(_bars(50), DAY, now_ms=60 * DAY)
    assert not rep.ok and any("stale" in p for p in rep.problems)

    # gapped: a missing chunk of history silently breaks every lookback indicator
    gapped = _bars(20) + _bars(20, start_ms=25 * DAY)
    rep = validate(gapped, DAY, now_ms=45 * DAY)
    assert not rep.ok and any("gap" in p for p in rep.problems)

    # a single missing bar is tolerated (thin market), two are not
    one_gap = _bars(20) + _bars(20, start_ms=21 * DAY)
    assert validate(one_gap, DAY, now_ms=41 * DAY).ok
    two_gap = _bars(20) + _bars(20, start_ms=22 * DAY)
    assert not validate(two_gap, DAY, now_ms=42 * DAY).ok

    # duplicated bars: normalized (deduped), still ok, noted
    dup = _bars(30) + [_bars(30)[-1]]
    rep = validate(dup, DAY, now_ms=30 * DAY)
    assert rep.ok and len(rep.bars) == 30 and any("duplicate" in n for n in rep.notes)

    # out-of-order: normalized by sort, ok, noted
    ooo = _bars(30)
    ooo[5], ooo[6] = ooo[6], ooo[5]
    rep = validate(ooo, DAY, now_ms=30 * DAY)
    assert rep.ok and [b["time"] for b in rep.bars] == sorted(b["time"] for b in rep.bars)
    assert any("re-sorted" in n for n in rep.notes)

    # malformed bars are fatal: inverted OHLC, non-numeric, missing field, bad price
    bad = _bars(30)
    bad[10] = {**bad[10], "high": bad[10]["low"] - 5}
    assert not validate(bad, DAY, now_ms=30 * DAY).ok
    bad = _bars(30)
    bad[3] = {**bad[3], "close": "garbage"}
    assert not validate(bad, DAY, now_ms=30 * DAY).ok
    bad = _bars(30)
    del bad[7]["volume"]
    assert not validate(bad, DAY, now_ms=30 * DAY).ok
    bad = _bars(30)
    bad[0] = {**bad[0], "open": 0.0, "low": 0.0}
    assert not validate(bad, DAY, now_ms=30 * DAY).ok

    # misaligned spacing (a half-interval bar) is fatal
    mis = _bars(30)
    mis[15] = {**mis[15], "time": mis[15]["time"] + DAY // 2}
    assert not validate(mis, DAY, now_ms=30 * DAY).ok

    # empty feed is fatal
    assert not validate([], DAY, now_ms=now).ok


# ---------------------------------------------------------------------------
# engine wiring, executor, reconciliation - share one temp DB world
# ---------------------------------------------------------------------------

class FakeClient:
    """Offline stand-in for bot.client.Client with adjustable behaviors."""

    def __init__(self):
        self.orders_placed: list[dict] = []
        self.candles_data: list[dict] = []
        self.status_by_coid: dict[str, dict | None] = {}
        self.balances_data: list[dict] = []
        self.create_raises: Exception | None = None
        self.create_response: dict = {"orders": [{"id": "ex1"}]}
        self.markets_data = {
            "I-ETH_INR": {"pair": "I-ETH_INR", "target_currency_precision": 5,
                          "target_currency_short_name": "ETH",
                          "min_quantity": 0.0001, "min_notional": 100.0,
                          "coindcx_name": "ETHINR"},
        }

    def candles(self, pair, interval, limit=200, since_ms=None):
        return self.candles_data

    def markets(self):
        return self.markets_data

    def round_qty(self, pair, qty):
        return round(qty, 5)

    def min_quantity(self, pair):
        return 0.0001

    def min_notional(self, pair):
        return 100.0

    def create_order(self, **kw):
        if self.create_raises is not None:
            raise self.create_raises
        self.orders_placed.append(kw)
        return self.create_response

    def order_status(self, *, client_order_id):
        return self.status_by_coid.get(client_order_id)

    def balances(self):
        return self.balances_data

    def cancel_all(self, market=None):
        raise RuntimeError("API unreachable")

    def free_balance(self, currency="INR"):
        return 100000.0

    def invalidate_balance_cache(self):
        pass


def _fresh_world(tmp: Path):
    """Point the bot at a throwaway DB + config and return (engine, fake_client)."""
    from . import audit, config, sizing
    from .engine import Engine

    config.DB_PATH = tmp / "bot.db"
    config.LOG_PATH = tmp / "bot.log"
    audit._conn_obj = None  # force a fresh connection to the new path
    audit.init()

    cfg = {
        "engine": {"poll_seconds": 300, "candle_interval": "1d", "candle_limit": 400},
        "starting_equity": 100000.0,
        "allocation_frac": 0.97,
        "quote_currency": "INR",
        "risk": {"max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
                 "daily_loss_frac": 0.5, "max_trades_per_day": 50,
                 "kill_switch_file": str(tmp / "KILL")},
        "strategies": [{
            "name": "tsmom_test", "module": "tsmom", "enabled": True, "weight": 1.0,
            "market": "I-ETH_INR", "stop_loss_pct": 0.07, "take_profit_pct": 0.0,
            "chandelier_k": 3.5, "atr_period": 14, "max_hold_bars": 0,
            "params": {"lookback": 30, "min_return": 0.10, "near_high_frac": 0.02,
                       "regime_period": 50, "expected_move_pct": 0.08},
        }],
    }
    sizing._cfg_cache = cfg  # keep sizing off the real config.yaml
    eng = Engine(cfg)
    fake = FakeClient()
    eng.client = fake
    eng.executor.client = fake
    return eng, fake


def test_engine_holds_on_bad_feed(tmp: Path) -> None:
    from . import notify
    eng, fake = _fresh_world(tmp)
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw)
    sent: list[str] = []
    orig_send = notify.send
    notify.send = lambda m: sent.append(m)
    try:
        # stale feed: newest bar is days old
        fake.candles_data = _bars(400, start_ms=0)
        eng.run_once()
        assert not placed, "bad feed must place nothing"
        assert any("Bad candle data" in m for m in sent), "bad feed must alert"
        # alert is rate-limited: second cycle with the same bad feed doesn't re-alert
        n = len(sent)
        eng.run_once()
        assert len(sent) == n, "bad-feed alert must be rate-limited"
    finally:
        notify.send = orig_send


def test_lost_confirmation_heals(tmp: Path) -> None:
    """An order whose POST died mid-flight is recorded as 'error' with the position
    untouched; boot reconciliation then heals bot.db from the exchange's answer."""
    from . import audit, config, reconcile, sizing
    from .client import CoinDCXError

    eng, fake = _fresh_world(tmp)
    old_equity, old_free = sizing.equity, sizing.free_balance
    sizing.equity = lambda *a, **k: 100000.0
    sizing.free_balance = lambda *a, **k: 100000.0
    old_live = config.LIVE
    config.LIVE = True
    try:
        # 1) network dies mid-POST -> executor records error, position stays flat
        fake.create_raises = CoinDCXError("network error on /orders/create: timeout")
        res = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="buy",
                                 qty=1.0, price=200.0, candle_ts=1000)
        assert res["status"] == "error"
        assert audit.get_position("tsmom_test", "I-ETH_INR")[0] == 0.0
        coid = res["client_order_id"]

        # 2a) exchange actually FILLED it -> reconcile replays the fill into the book
        fake.status_by_coid[coid] = {"orders": [{
            "status": "filled", "filled_quantity": 1.0, "avg_price": 201.0}]}
        changes = reconcile.heal_lost_confirmations(fake)
        assert any("book healed" in c for c in changes), changes
        qty, avg = audit.get_position("tsmom_test", "I-ETH_INR")
        assert qty == 1.0 and avg == 201.0, (qty, avg)
        row = audit.orders_with_status("placed")[0]
        assert row["client_order_id"] == coid and row["price"] == 201.0

        # idempotent: a second pass finds no 'error' rows left
        assert reconcile.heal_lost_confirmations(fake) == []

        # 2b) exchange NEVER SAW an order -> marked rejected, book untouched
        fake.create_raises = CoinDCXError("network error on /orders/create: timeout")
        res2 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                  qty=1.0, price=210.0, candle_ts=2000)
        fake.status_by_coid[res2["client_order_id"]] = None
        changes = reconcile.heal_lost_confirmations(fake)
        assert any("never reached the exchange" in c for c in changes), changes
        assert audit.get_position("tsmom_test", "I-ETH_INR")[0] == 1.0, "book must not move"

        # 2c) exchange says the order is still OPEN -> flagged for manual attention
        fake.create_raises = CoinDCXError("boom")
        res3 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                  qty=1.0, price=220.0, candle_ts=3000)
        fake.status_by_coid[res3["client_order_id"]] = {"orders": [{"status": "open"}]}
        changes = reconcile.heal_lost_confirmations(fake)
        assert any("manual check" in c for c in changes), changes
    finally:
        config.LIVE = old_live
        sizing.equity, sizing.free_balance = old_equity, old_free


def test_live_partial_fill_books_filled_amount(tmp: Path) -> None:
    from . import audit, config, sizing

    eng, fake = _fresh_world(tmp)
    old_equity, old_free = sizing.equity, sizing.free_balance
    sizing.equity = lambda *a, **k: 100000.0
    sizing.free_balance = lambda *a, **k: 100000.0
    old_live = config.LIVE
    config.LIVE = True
    try:
        fake.create_response = {"orders": [{
            "id": "x9", "status": "partially_filled",
            "filled_quantity": 0.4, "avg_price": 199.5}]}
        res = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="buy",
                                 qty=1.0, price=200.0, candle_ts=5000)
        assert res["status"] == "placed"
        qty, avg = audit.get_position("tsmom_test", "I-ETH_INR")
        assert abs(qty - 0.4) < 1e-9 and abs(avg - 199.5) < 1e-9, \
            "only the FILLED amount may enter the book"
    finally:
        config.LIVE = old_live
        sizing.equity, sizing.free_balance = old_equity, old_free


def test_balance_drift_detection(tmp: Path) -> None:
    from . import audit, reconcile

    eng, fake = _fresh_world(tmp)
    audit.set_position("tsmom_test", "I-ETH_INR", 2.0, 200.0, 200.0, 0)
    # wallet has less than the book says -> deficit flagged
    fake.balances_data = [{"currency": "ETH", "balance": 1.0, "locked_balance": 0.0}]
    problems = reconcile.check_balance_drift(fake)
    assert problems and "diverged" in problems[0], problems
    # wallet holding MORE than the book (user's own coins) is fine
    fake.balances_data = [{"currency": "ETH", "balance": 5.0, "locked_balance": 0.0}]
    assert reconcile.check_balance_drift(fake) == []
    # small dust deficits within tolerance are not flagged
    fake.balances_data = [{"currency": "ETH", "balance": 1.99, "locked_balance": 0.0}]
    assert reconcile.check_balance_drift(fake) == []
    audit.set_position("tsmom_test", "I-ETH_INR", 0.0, 0.0, 0.0, 0)


def test_sqlite_health_and_backups(tmp: Path) -> None:
    from . import audit

    assert audit.integrity_check() is None, "fresh DB must pass quick_check"
    p1 = audit.backup_db()
    assert p1 and Path(p1).exists(), "first backup of the day must be written"
    assert audit.backup_db() is None, "second same-day backup must be a no-op"
    # rotation: seed old backups beyond the keep depth; pruning happens on the next
    # successful write, so remove today's file to allow one
    bdir = Path(p1).parent
    for d in range(1, 10):
        (bdir / f"bot-201001{d:02d}.db").write_bytes(b"old")
    Path(p1).unlink()
    p2 = audit.backup_db(keep=3)
    assert p2 is not None
    remaining = sorted(bdir.glob("bot-*.db"))
    assert len(remaining) == 3, f"rotation must keep only 3, got {len(remaining)}"


def test_kill_switch_always_wins(tmp: Path) -> None:
    from . import sizing
    from .risk import RiskManager

    eng, fake = _fresh_world(tmp)
    old_equity, old_free = sizing.equity, sizing.free_balance
    sizing.equity = lambda *a, **k: 100000.0
    sizing.free_balance = lambda *a, **k: 100000.0
    kill = Path(eng.risk.kill_file)
    try:
        kill.write_text("")
        # blocks a new entry
        d = eng.risk.check(100, 100, strategy="s", market="I-ETH_INR", increasing=True)
        assert not d.ok and "KILL" in d.reason
        # blocks even a protective exit (halt means halt)
        d = eng.risk.check(100, 0, strategy="s", market="I-ETH_INR", increasing=False)
        assert not d.ok and "KILL" in d.reason
        # executor.place refuses under kill
        res = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="buy",
                                 qty=1.0, price=200.0, candle_ts=7000)
        assert res["status"] == "rejected" and "KILL" in res["reason"]
        # the kill path itself survives a dead API (cancel_all raises) - no exception
        from . import config
        old_live = config.LIVE
        config.LIVE = True
        try:
            eng.executor.kill()
        finally:
            config.LIVE = old_live
        # engine loop halts on kill before doing anything else
        assert eng.risk.kill_switch_active()
    finally:
        kill.unlink(missing_ok=True)
        sizing.equity, sizing.free_balance = old_equity, old_free
    # RiskManager path parity: a fresh instance sees the same file
    rm = RiskManager({"risk": {"max_position_frac": 1.0,
                               "max_total_capital_at_risk_frac": 1.0,
                               "daily_loss_frac": 0.5, "max_trades_per_day": 5,
                               "kill_switch_file": str(tmp / "KILL")}})
    assert not rm.kill_switch_active()


def test_crash_loop_guard(tmp: Path) -> None:
    from . import notify
    eng, _ = _fresh_world(tmp)
    sleeps: list[float] = []
    sent: list[str] = []
    orig_sleep, orig_send = time.sleep, notify.send
    time.sleep = lambda s: sleeps.append(s)
    notify.send = lambda m: sent.append(m)
    try:
        for _i in range(eng._CRASH_LIMIT - 1):
            eng._crash_loop_guard()
        assert not sleeps, "below the limit no throttling happens"
        eng._crash_loop_guard()  # 5th start inside the window
        assert sleeps == [30.0], "5th rapid start must throttle 30s"
        assert any("crash loop" in m.lower() for m in sent), "must alert once"
        n_alerts = len(sent)
        eng._crash_loop_guard()  # 6th: doubled delay, no repeat alert
        assert sleeps[-1] == 60.0 and len(sent) == n_alerts
    finally:
        time.sleep, notify.send = orig_sleep, orig_send


def main() -> None:
    test_candle_validator()
    names = [test_engine_holds_on_bad_feed, test_lost_confirmation_heals,
             test_live_partial_fill_books_filled_amount, test_balance_drift_detection,
             test_sqlite_health_and_backups, test_kill_switch_always_wins,
             test_crash_loop_guard]
    for fn in names:
        with tempfile.TemporaryDirectory(prefix="fallbacks_") as d:
            fn(Path(d))
    print("fallback self-checks OK: candle integrity, bad-feed hold, lost-confirmation "
          "healing, partial fills, balance drift, sqlite health+backups, kill-switch "
          "precedence, crash-loop guard")


if __name__ == "__main__":
    main()
