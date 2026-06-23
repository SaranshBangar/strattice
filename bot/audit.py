"""SQLite audit log: every signal, every order, plus position state.

The orders table's client_order_id UNIQUE constraint is the idempotency guard:
re-submitting the same logical order (on retry/restart) is rejected by the DB.
Risk state (daily P&L, trade count, open exposure) is rebuilt from here on startup,
so a crash/restart never loses safety accounting.
"""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from . import config

_lock = threading.Lock()  # ponytail: one global lock, fine for single-process loop


def _conn() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init() -> None:
    with _lock, _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS signals (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts        TEXT NOT NULL,
                strategy  TEXT NOT NULL,
                market    TEXT NOT NULL,
                action    TEXT NOT NULL,         -- BUY / SELL / HOLD
                price     REAL,
                meta      TEXT
            );
            CREATE TABLE IF NOT EXISTS orders (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                client_order_id TEXT NOT NULL UNIQUE,   -- idempotency key
                ts              TEXT NOT NULL,
                strategy        TEXT NOT NULL,
                market          TEXT NOT NULL,
                side            TEXT NOT NULL,
                qty             REAL NOT NULL,
                price           REAL NOT NULL,
                notional        REAL NOT NULL,
                status          TEXT NOT NULL,          -- placed / rejected / dry_run / error
                dry_run         INTEGER NOT NULL,
                exchange_order_id TEXT,
                realized_pnl    REAL NOT NULL DEFAULT 0,
                response        TEXT
            );
            CREATE TABLE IF NOT EXISTS positions (
                strategy  TEXT NOT NULL,
                market    TEXT NOT NULL,
                qty       REAL NOT NULL DEFAULT 0,   -- signed: + long, - short
                avg_price REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (strategy, market)
            );
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_signal(strategy: str, market: str, action: str, price, meta: dict | None = None) -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO signals(ts,strategy,market,action,price,meta) VALUES(?,?,?,?,?,?)",
            (_now(), strategy, market, action, price, json.dumps(meta or {})),
        )


def order_exists(client_order_id: str) -> bool:
    with _lock, _conn() as c:
        row = c.execute(
            "SELECT 1 FROM orders WHERE client_order_id=?", (client_order_id,)
        ).fetchone()
        return row is not None


def log_order(o: dict) -> bool:
    """Insert an order row. Returns False if the client_order_id already exists (idempotent skip)."""
    with _lock, _conn() as c:
        try:
            c.execute(
                """INSERT INTO orders
                   (client_order_id,ts,strategy,market,side,qty,price,notional,
                    status,dry_run,exchange_order_id,realized_pnl,response)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    o["client_order_id"], _now(), o["strategy"], o["market"], o["side"],
                    o["qty"], o["price"], o["notional"], o["status"], int(o["dry_run"]),
                    o.get("exchange_order_id"), o.get("realized_pnl", 0.0),
                    json.dumps(o.get("response", {})),
                ),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def get_position(strategy: str, market: str) -> tuple[float, float]:
    with _lock, _conn() as c:
        row = c.execute(
            "SELECT qty,avg_price FROM positions WHERE strategy=? AND market=?",
            (strategy, market),
        ).fetchone()
        return (row["qty"], row["avg_price"]) if row else (0.0, 0.0)


def set_position(strategy: str, market: str, qty: float, avg_price: float) -> None:
    with _lock, _conn() as c:
        c.execute(
            """INSERT INTO positions(strategy,market,qty,avg_price) VALUES(?,?,?,?)
               ON CONFLICT(strategy,market) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price""",
            (strategy, market, qty, avg_price),
        )


def today_stats() -> dict:
    """Risk accounting for the current UTC day, rebuilt from the orders/positions tables."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock, _conn() as c:
        row = c.execute(
            """SELECT COUNT(*) AS n, COALESCE(SUM(realized_pnl),0) AS pnl
               FROM orders WHERE status IN ('placed','dry_run') AND substr(ts,1,10)=?""",
            (day,),
        ).fetchone()
        exposure = c.execute(
            "SELECT COALESCE(SUM(ABS(qty)*avg_price),0) AS exp FROM positions"
        ).fetchone()["exp"]
    return {"trades_today": row["n"], "realized_today": row["pnl"], "capital_at_risk": exposure}


def open_positions() -> list[sqlite3.Row]:
    with _lock, _conn() as c:
        return c.execute("SELECT * FROM positions WHERE qty != 0").fetchall()
