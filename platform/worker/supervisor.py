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

Run:  DATABASE_URL=... ENCRYPTION_MASTER_KEY=... python platform/worker/supervisor.py
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

REPO = Path(__file__).resolve().parents[2]   # platform/worker -> platform -> repo root
USERS_DIR = REPO / "data" / "users"
load_dotenv(REPO / "platform" / ".env")
load_dotenv(REPO / ".env")  # fall back to repo .env if present
POLL = int(os.getenv("SUPERVISOR_POLL", "30"))
STARTING_EQUITY = 1000.0  # mirrors config_gen._BASE; DRY_RUN book equity baseline

_procs: dict[str, dict] = {}  # uid -> {"proc": Popen, "hash": str}

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


def _spawn(u: dict, cfg_path: Path, db: Path, log: Path) -> subprocess.Popen:
    env = os.environ.copy()
    env["CONFIG_PATH"] = str(cfg_path)
    env["BOT_DB_PATH"] = str(db)
    env["BOT_LOG_PATH"] = str(log)
    env["COINDCX_API_KEY"] = u["api_key"]
    env["COINDCX_SECRET_KEY"] = u["secret"]
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


def _project(db: Path) -> tuple[list[dict], list[dict], dict]:
    """Read a user's engine SQLite (read-only) into (trades, positions, equity). Empty if absent."""
    if not db.exists():
        return [], [], {"equity": STARTING_EQUITY, "free": STARTING_EQUITY,
                        "realized_today": 0.0, "trades_today": 0}
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
        equity = STARTING_EQUITY + total_realized  # DRY_RUN book; LIVE balance enrichment = later
        equity = {"equity": equity, "free": equity - car,
                  "realized_today": today["p"], "trades_today": today["n"]}
        return trades, [{"strategy": p["strategy"], "market": p["market"],
                         "qty": p["qty"], "avg_price": p["avg_price"]} for p in pos], equity
    finally:
        con.close()


def _publish_one(uid: str, db: Path) -> tuple[str, Exception | None]:
    """Pure I/O (SQLite read-only + D1 REST) with no shared mutable state per user - runs in
    the reconcile thread pool. `_procs[uid]` is only ever READ here; every write to `_procs`
    happens on the main thread before/after the pool runs, never concurrently with it."""
    try:
        db_client = _thread_db()
        trades, positions, equity = _project(db)
        store.publish(db_client, uid, trades, positions, equity)
        rc = _procs[uid]["proc"].poll()
        store.heartbeat(db_client, uid, None if rc is None else f"engine exited rc={rc}")
        return uid, None
    except Exception as e:  # projection/publish must not kill the loop or the pool
        return uid, e


def _reconcile(conn) -> None:
    users = store.active_users(conn)
    desired = set()
    to_publish: list[tuple[str, Path]] = []
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
        if not alive or cur["hash"] != h:
            if cur:
                _stop(cur["proc"])
            _procs[uid] = {"proc": _spawn(u, cfg_path, db, log), "hash": h}
            print(f"[supervisor] (re)started engine for {uid} (tier={u['tier']} live={u['live']})")

        to_publish.append((uid, db))

    # Project + publish + heartbeat are the I/O-bound part of the cycle (one SQLite read plus
    # a handful of D1 REST round trips per user) and don't touch _procs/_spawn/_stop, so they
    # run concurrently across users instead of serially - this is what keeps one poll cycle's
    # duration from growing linearly with the active-user count.
    if to_publish:
        with ThreadPoolExecutor(max_workers=min(8, len(to_publish))) as pool:
            futures = [pool.submit(_publish_one, uid, db) for uid, db in to_publish]
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
            print(f"[supervisor] stopped engine for {uid} (deactivated)")


def main() -> None:
    conn = store.connect()
    print(f"[supervisor] up. polling every {POLL}s. users dir: {USERS_DIR}")
    try:
        while True:
            try:
                _reconcile(conn)
            except Exception as e:  # DB blip etc. — log and keep going
                print(f"[supervisor] reconcile error: {e}", file=sys.stderr)
            time.sleep(POLL)
    except KeyboardInterrupt:
        print("\n[supervisor] shutting down, stopping engines...")
        for p in _procs.values():
            _stop(p["proc"])


if __name__ == "__main__":
    main()
