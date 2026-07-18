"""Multi-tenant supervisor: one `python -m bot.engine` subprocess per active user.

Why subprocess-per-user (not N in-process engines): bot/config.py reads keys + the LIVE/DRY_RUN
flag as MODULE GLOBALS at import. Separate processes give each user their own keys and live flag
for free, and isolate crashes (one user's engine dying can't take down others). Per-user process
isolation is also the natural scale-up path noted in RESEARCH.md.

Each cycle:
  1. read active users (desired state) from Postgres
  2. generate/refresh each user's config.yaml (tier caps + allowed strategies)
  3. (re)spawn the engine subprocess when missing or its config/live flag changed
  4. project each engine's SQLite -> Postgres read model + heartbeat
  5. stop engines for users no longer active

Run:  DATABASE_URL=... ENCRYPTION_MASTER_KEY=... python strattice/worker/supervisor.py
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

import config_gen
import store

REPO = Path(__file__).resolve().parents[2]   # strattice/worker -> strattice -> repo root
sys.path.insert(0, str(REPO))  # so `bot.client` (repo-root package) is importable below
from bot.client import Client, CoinDCXError  # noqa: E402  (needs sys.path fixup above)

USERS_DIR = REPO / "data" / "users"
load_dotenv(REPO / "strattice" / ".env")
load_dotenv(REPO / ".env")  # fall back to repo .env if present
POLL = int(os.getenv("SUPERVISOR_POLL", "30"))
STARTING_EQUITY = 1000.0  # mirrors config_gen._BASE; DRY_RUN book equity baseline
CRED_ERROR_MSG = (
    "CoinDCX API keys look invalid, expired, or disabled - update them in "
    "Account to resume live trading."
)

_procs: dict[str, dict] = {}  # uid -> {"proc": Popen, "hash": str}

# Crash-loop protection: an engine that keeps dying (bad market data, corrupt user DB,
# a poisoned config) must not be respawned every 30s forever - that hammers the exchange
# and buries real errors. Track recent unexpected exits per user; past the threshold,
# hold the respawn for a growing backoff and surface the state via heartbeat.
_CRASH_WINDOW = 600.0   # seconds: exits counted within this sliding window
_CRASH_LIMIT = 5        # unexpected exits in the window before backing off
_CRASH_BACKOFF0 = 120.0  # first hold; doubles per additional trip, capped below
_CRASH_BACKOFF_MAX = 1800.0
_crash: dict[str, dict] = {}  # uid -> {"exits": [monotonic..], "until": float, "backoff": float}


def _crash_note_exit(uid: str) -> None:
    now = time.monotonic()
    st = _crash.setdefault(uid, {"exits": [], "until": 0.0, "backoff": _CRASH_BACKOFF0})
    st["exits"] = [t for t in st["exits"] if now - t < _CRASH_WINDOW] + [now]
    if len(st["exits"]) >= _CRASH_LIMIT:
        st["until"] = now + st["backoff"]
        print(f"[supervisor] engine for {uid} crash-looping "
              f"({len(st['exits'])} exits in {_CRASH_WINDOW:.0f}s) - holding respawn "
              f"{st['backoff']:.0f}s", file=sys.stderr)
        st["backoff"] = min(st["backoff"] * 2, _CRASH_BACKOFF_MAX)
        st["exits"] = []


def _crash_holding(uid: str) -> float:
    """Seconds remaining on a crash-loop hold for this user (0 = clear to spawn)."""
    st = _crash.get(uid)
    if not st:
        return 0.0
    return max(0.0, st["until"] - time.monotonic())


def _crash_reset(uid: str) -> None:
    """A config change or deactivation clears the crash history (new state, new chances)."""
    _crash.pop(uid, None)


def _harden_perms(user_dir: Path) -> None:
    """Least-privilege on per-user state: the dir is 0700 and every file in it (config,
    SQLite DB + WAL/SHM, log, KILL, alert spool) is 0600 - other local users can read
    none of it. POSIX only; a no-op elsewhere and never fatal."""
    if os.name != "posix":
        return
    try:
        os.chmod(user_dir, 0o700)
        for f in user_dir.iterdir():
            if f.is_file():
                os.chmod(f, 0o600)
    except OSError as e:
        print(f"[supervisor] perms hardening failed for {user_dir}: {e}", file=sys.stderr)


def _check_env_perms() -> None:
    """Warn once at startup if a .env holding master keys/API creds is readable by group
    or other - the single most common way secrets leak on a shared VPS."""
    if os.name != "posix":
        return
    for p in (REPO / ".env", REPO / "strattice" / ".env"):
        try:
            if p.exists() and (p.stat().st_mode & 0o077):
                print(f"[supervisor] WARNING: {p} is group/other-readable - run: "
                      f"chmod 600 {p}", file=sys.stderr)
        except OSError:
            pass

# requests.Session (used by store.D1) isn't documented as safe for concurrent use from
# multiple threads (its cookie jar isn't), so the publish/heartbeat thread pool below gets
# its own D1 client per worker thread instead of sharing the main reconcile loop's `conn`.
_thread_local = threading.local()


def _thread_db() -> store.D1:
    db = getattr(_thread_local, "db", None)
    if db is None:
        db = store.connect()
        _thread_local.db = db
    return db


def _kill_rel(uid: str) -> str:
    return f"data/users/{uid}/KILL"  # ROOT-relative; risk.py joins onto config.ROOT


def _spawn(u: dict, cfg_path: Path, db: Path, log: Path,
           suppress_start_alert: bool = False) -> subprocess.Popen:
    env = os.environ.copy()
    env["CONFIG_PATH"] = str(cfg_path)
    env["BOT_DB_PATH"] = str(db)
    env["BOT_LOG_PATH"] = str(log)
    env["COINDCX_API_KEY"] = u["api_key"]
    env["COINDCX_SECRET_KEY"] = u["secret"]
    # A config-only recycle (strategy add/remove/edit) must not fire a fresh "bot started"
    # Telegram alert - the engine reads this flag and stays quiet on start. Genuine first
    # starts and go-live transitions leave it unset so those still alert.
    if suppress_start_alert:
        env["BOT_SUPPRESS_START_ALERT"] = "1"
    else:
        env.pop("BOT_SUPPRESS_START_ALERT", None)
    if u["live"]:
        env["DRY_RUN"] = "false"
        env["LIVE_TRADING_CONFIRM"] = "I_UNDERSTAND_LIVE_TRADING"
    else:
        env["DRY_RUN"] = "true"
        env.pop("LIVE_TRADING_CONFIRM", None)
    return subprocess.Popen([sys.executable, "-m", "bot.engine"], cwd=str(REPO), env=env)


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def _stop_all() -> None:
    """Stop and forget every managed engine. Used on pause, restart, and shutdown."""
    for uid in list(_procs):
        _stop(_procs.pop(uid)["proc"])


_price_client: Client | None = None


def _mark_price(pair: str) -> float | None:
    """Last close for a market, via the public (no-auth) candles endpoint. None on any
    failure - callers must treat that position's unrealized P&L as unknown, not zero. The
    endpoint wants the candle "pair" id (e.g. "I-SOL_INR"), which is exactly what positions
    store, so no symbol translation is needed. A thin market can momentarily have no 1m bar,
    so fall back to a coarser interval before giving up."""
    global _price_client
    if _price_client is None:
        _price_client = Client()
    for interval in ("1m", "15m", "1d"):
        try:
            bars = _price_client.candles(pair, interval, limit=1)
            if bars:
                return float(bars[-1]["close"])
        except Exception as e:
            print(f"[supervisor] mark price fetch failed for {pair} @ {interval}: {e}",
                  file=sys.stderr)
    return None


def _unrealized_pnl(pos: list[dict]) -> float:
    """Mark-to-market P&L on open positions (qty * (last price - avg cost)), summed across
    positions. Skips a position (contributes 0) if its price can't be fetched, rather than
    failing the whole publish over one flaky market. Logs any markets it couldn't price so a
    silent 0 is distinguishable from a genuine flat P&L."""
    total = 0.0
    unpriced: list[str] = []
    for p in pos:
        mark = _mark_price(p["market"])
        if mark is None:
            unpriced.append(p["market"])
            continue
        total += p["qty"] * (mark - p["avg_price"])
    if unpriced:
        print(f"[supervisor] unrealized P&L: could not price {unpriced} - counted as 0 "
              f"this cycle", file=sys.stderr)
    return total


def _live_book(u: dict, quote: str, car: float) -> tuple[float | None, str | None]:
    """Real free balance + capital-at-risk for a LIVE user, mirroring bot/sizing.py's
    equity(). (None, None) on a flaky exchange/network error, so callers can fall back
    rather than fail the whole publish. (None, CRED_ERROR_MSG) when a 401/403 means the
    keys themselves are the problem - callers must not paper over that with a fake
    balance (see _project)."""
    try:
        return Client(key=u["api_key"], secret=u["secret"]).free_balance(quote) + car, None
    except Exception as e:
        print(f"[supervisor] live balance fetch failed for {u['user_id']}: {e}", file=sys.stderr)
        cred_error = CRED_ERROR_MSG if isinstance(e, CoinDCXError) and str(e)[:3] in ("401", "403") else None
        return None, cred_error


def _project(db: Path, u: dict, quote: str) -> tuple[list[dict], list[dict], dict, str | None]:
    """Read a user's engine SQLite (read-only) into (trades, positions, equity, cred_error).
    Empty if absent. LIVE users get real exchange balance for equity; DRY_RUN keeps the fixed
    paper baseline. cred_error is set when a LIVE user's own API keys are why their balance
    can't be read - the equity dict still gets a number (so downstream code never sees a
    hole), but it's the paper baseline, and callers must surface cred_error rather than
    let that paper number pass as their real book equity.

    "equity"/"free" are both the CASH-BASIS book figure (total minus the cost basis of whatever
    is currently deployed in open positions) - this is what the dashboard shows as "Book equity",
    so opening a trade visibly moves it. "unrealized_pnl" is the separate mark-to-market P&L on
    open positions, via live pricing - added together they reconstruct true net worth without
    needing the exchange app. This is purely a display projection; it does NOT feed
    bot/sizing.py's own equity()/free_balance()/drawdown(), which the live engine and risk
    breaker use and which intentionally stay mark-at-cost."""
    live = bool(u.get("live"))
    if not db.exists():
        book, cred_error = _live_book(u, quote, 0.0) if live else (None, None)
        eq = book or STARTING_EQUITY
        return [], [], {"equity": eq, "free": eq, "unrealized_pnl": 0.0,
                        "realized_today": 0.0, "trades_today": 0}, cred_error
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        orders = con.execute(
            """select client_order_id,strategy,market,side,qty,price,notional,status,
                      dry_run,realized_pnl,tds,ts from orders order by ts desc limit 200"""
        ).fetchall()
        trades = [{
            "coid": o["client_order_id"], "strategy": o["strategy"], "market": o["market"],
            "side": o["side"], "qty": o["qty"], "price": o["price"], "notional": o["notional"],
            "status": o["status"], "dry_run": bool(o["dry_run"]),
            "pnl": o["realized_pnl"], "tds": o["tds"], "ts": o["ts"],
        } for o in orders]
        pos = [dict(p) for p in con.execute(
            "select strategy,market,qty,avg_price from positions where qty != 0").fetchall()]
        total_realized = con.execute(
            "select coalesce(sum(realized_pnl),0) v from orders where status in ('placed','dry_run')"
        ).fetchone()["v"]
        car = con.execute(
            "select coalesce(sum(abs(qty)*avg_price),0) v from positions").fetchone()["v"]
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today = con.execute(
            """select count(*) n, coalesce(sum(realized_pnl),0) p from orders
               where status in ('placed','dry_run') and substr(ts,1,10)=?""", (day,)).fetchone()
        book, cred_error = _live_book(u, quote, car) if live else (None, None)
        raw_equity = book or (STARTING_EQUITY + total_realized)
        book_equity = raw_equity - car
        equity = {"equity": book_equity, "free": book_equity,
                  "unrealized_pnl": _unrealized_pnl(pos),
                  "realized_today": today["p"], "trades_today": today["n"]}
        if pos:
            print(f"[supervisor] {u['user_id'][:8]} book_equity={book_equity:.2f} "
                  f"unrealized={equity['unrealized_pnl']:.2f} car={car:.2f} "
                  f"positions={[p['market'] for p in pos]}", file=sys.stderr)
        return trades, [{"strategy": p["strategy"], "market": p["market"],
                         "qty": p["qty"], "avg_price": p["avg_price"]} for p in pos], equity, cred_error
    finally:
        con.close()


def _publish_one(uid: str, db: Path, u: dict, quote: str) -> tuple[str, Exception | None]:
    """Pure I/O (SQLite read-only + D1 REST, plus a signed balance call for LIVE users) with
    no shared mutable state per user - runs in the reconcile thread pool. `_procs[uid]` is only
    ever READ here; every write to `_procs` happens on the main thread before/after the pool
    runs, never concurrently with it."""
    try:
        db_client = _thread_db()
        trades, positions, equity, cred_error = _project(db, u, quote)
        store.publish(db_client, uid, trades, positions, equity)
        entry = _procs[uid]
        rc = entry["proc"].poll()
        # An exited engine is the more urgent problem; a credential error only shows once
        # the engine is confirmed still running.
        if rc is not None and entry.get("held"):
            hold = _crash_holding(uid)
            err = (f"engine crash-looping (rc={rc}); respawn held for ~{hold:.0f}s "
                   "- check the bot log")
        elif rc is not None:
            err = f"engine exited rc={rc}"
        else:
            err = cred_error
        store.heartbeat(db_client, uid, err)
        return uid, None
    except Exception as e:  # projection/publish must not kill the loop or the pool
        return uid, e


def _reconcile(conn) -> None:
    users = store.active_users(conn)
    desired = set()
    to_publish: list[tuple[str, Path, dict, str]] = []
    for u in users:
        uid = u["user_id"]
        desired.add(uid)
        d = USERS_DIR / uid
        cfg = config_gen.build_config(u["tier"], u["strategies"], kill_switch_file=_kill_rel(uid))
        cfg_path, db, log = d / "config.yaml", d / "bot.db", d / "bot.log"
        # Dumped once and reused for both the write and the change-hash (previously dumped twice).
        dumped = yaml.safe_dump(cfg, sort_keys=False)
        config_gen.write_config(cfg_path, cfg, dumped)
        h = hashlib.sha256((dumped + str(u["live"])).encode()).hexdigest()

        cur = _procs.get(uid)
        alive = bool(cur) and cur["proc"].poll() is None
        changed = bool(cur) and cur["hash"] != h
        if changed:
            _crash_reset(uid)  # new config = new state; crash history no longer applies
        if not alive or changed:
            respawn = True
            if cur and not alive and not changed:
                # Unexpected exit with an unchanged config -> crash-loop accounting.
                if _crash_holding(uid) > 0:
                    respawn = False  # still in backoff: leave the dead entry, don't count again
                else:
                    _crash_note_exit(uid)
                    respawn = _crash_holding(uid) == 0
            if respawn:
                # Quiet the start alert only when a still-running engine is recycled for a pure
                # config/strategy change (same live flag). A first start, a crash restart, or a
                # go-live/go-paper transition all still alert.
                config_only = bool(cur) and alive and cur.get("live") == u["live"]
                if cur:
                    _stop(cur["proc"])
                _procs[uid] = {
                    "proc": _spawn(u, cfg_path, db, log, suppress_start_alert=config_only),
                    "hash": h,
                    "live": u["live"],
                    "held": False,
                }
                print(f"[supervisor] (re)started engine for {uid} (tier={u['tier']} "
                      f"live={u['live']} quiet_start={config_only})")
            else:
                cur["held"] = True

        _harden_perms(d)  # per-user dir 0700, config/db/log/spool files 0600
        to_publish.append((uid, db, u, cfg["quote_currency"]))

    # Project + publish + heartbeat are the I/O-bound part of the cycle (one SQLite read plus
    # a handful of D1 REST round trips per user) and don't touch _procs/_spawn/_stop, so they
    # run concurrently across users instead of serially - this is what keeps one poll cycle's
    # duration from growing linearly with the active-user count.
    if to_publish:
        with ThreadPoolExecutor(max_workers=min(8, len(to_publish))) as pool:
            futures = [pool.submit(_publish_one, uid, db, u, quote) for uid, db, u, quote in to_publish]
            for fut in as_completed(futures):
                uid, err = fut.result()
                if err is not None:
                    try:
                        store.heartbeat(conn, uid, f"publish error: {err}")
                    except Exception:  # one user's D1 error must not affect the others
                        pass

    for uid in list(_procs):
        if uid not in desired:
            _stop(_procs.pop(uid)["proc"])
            _crash_reset(uid)
            print(f"[supervisor] stopped engine for {uid} (deactivated)")


_applied_restart_seq = 0  # last restart_seq acted on; survives across cycles, resets on process restart


def _tick(conn) -> None:
    """One control-aware poll: obey the admin console's desired regime, then publish status.

    'paused' stops every engine but keeps the loop alive, so a later 'running' (or restart)
    written to D1 resumes trading without touching the process. A restart is a bumped
    restart_seq: recycle all engines (they respawn in the same _reconcile) and record the
    seq so we don't loop on it."""
    global _applied_restart_seq
    control = store.read_control(conn)
    if control["desired_state"] == "paused":
        if _procs:
            _stop_all()
            print("[supervisor] paused by admin - stopped all engines")
        store.write_status(conn, "paused", 0, _applied_restart_seq)
        return
    if control["restart_seq"] != _applied_restart_seq:
        _stop_all()
        _applied_restart_seq = control["restart_seq"]
        print(f"[supervisor] restart requested (seq={_applied_restart_seq}) - recycling all engines")
    _reconcile(conn)
    store.write_status(conn, "running", len(_procs), _applied_restart_seq)


def main() -> None:
    _check_env_perms()
    conn = store.connect()
    print(f"[supervisor] up. polling every {POLL}s. users dir: {USERS_DIR}")
    try:
        while True:
            try:
                _tick(conn)
            except Exception as e:  # DB blip etc. — log and keep going
                print(f"[supervisor] reconcile error: {e}", file=sys.stderr)
            time.sleep(POLL)
    except KeyboardInterrupt:
        print("\n[supervisor] shutting down, stopping engines...")
        _stop_all()


if __name__ == "__main__":
    main()
