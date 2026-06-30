"""Cloudflare D1 access for the supervisor (over the D1 REST API — no Workers binding on a
plain server). Reads desired state, writes observed state. The ONLY integration point with
the Next.js app, which talks to the SAME D1 database.

Env: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN (D1 Edit permission).
"""
from __future__ import annotations

import os
import time
import uuid

import requests


class D1:
    """Minimal D1 REST client. One statement per call; `?` positional params (SQLite style)."""

    def __init__(self) -> None:
        acct = os.getenv("CF_ACCOUNT_ID")
        dbid = os.getenv("CF_D1_DATABASE_ID")
        self.token = os.getenv("CF_API_TOKEN")
        if not (acct and dbid and self.token):
            raise RuntimeError("set CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN")
        self.url = (f"https://api.cloudflare.com/client/v4/accounts/{acct}"
                    f"/d1/database/{dbid}/query")
        self._s = requests.Session()

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        r = self._s.post(self.url, headers={"Authorization": f"Bearer {self.token}"},
                         json={"sql": sql, "params": params or []}, timeout=30)
        r.raise_for_status()
        body = r.json()
        if not body.get("success"):
            raise RuntimeError(f"D1 error: {body.get('errors')}")
        return body["result"][0]["results"]


def connect() -> D1:
    return D1()


def _effective_tier(row: dict) -> str:
    """Entitled while period hasn't ended and the sub isn't dead; 'cancelled' keeps access until
    period_end (grace). Mirrors web/lib/queries.ts effectiveTier(). period_end = unix seconds."""
    end = row.get("period_end")
    live = end is not None and end > time.time()
    ok = live and row.get("status") in ("active", "cancelled")
    return row["tier"] if (ok and row.get("tier")) else "free"


def active_users(db: D1) -> list[dict]:
    """Bot-on users with linked credentials. Each: {user_id, tier, live, strategies[], key, secret}.
    Credentials decrypted here (in memory). Users without creds are skipped."""
    import crypto  # local import: only the supervisor path needs the master key

    rows = db.query(
        """select b.user_id, b.live, s.tier, s.status, s.period_end,
                  c.api_key_enc, c.secret_enc
           from bot_state b
           left join subscriptions s on s.user_id = b.user_id
           left join exchange_credentials c on c.user_id = b.user_id
           where b.active = 1"""
    )
    out = []
    for r in rows:
        if not r.get("api_key_enc") or not r.get("secret_enc"):
            continue
        uid = r["user_id"]
        strats = db.query(
            """select template, market, params, enabled from user_strategies
               where user_id = ? order by position, created_at""", [uid])
        out.append({
            "user_id": uid,
            "tier": _effective_tier(r),
            "live": bool(r["live"]),
            "strategies": [{**s, "enabled": bool(s["enabled"]),
                            "params": __import__("json").loads(s["params"]) if s.get("params") else None}
                           for s in strats],
            "api_key": crypto.decrypt(r["api_key_enc"]),
            "secret": crypto.decrypt(r["secret_enc"]),
        })
    return out


def heartbeat(db: D1, user_id: str, error: str | None = None) -> None:
    db.query(
        """insert into bot_state(user_id, active, last_heartbeat, last_error)
           values (?, 1, ?, ?)
           on conflict(user_id) do update set last_heartbeat=excluded.last_heartbeat,
             last_error=excluded.last_error""",
        [user_id, int(time.time()), error],
    )


def _chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def publish(db: D1, user_id: str, trades: list[dict], positions: list[dict], equity: dict) -> None:
    """Upsert the read model from a user's engine SQLite projection.
    Multi-row INSERTs keep the REST round-trips bounded (D1 is one statement per call)."""
    for batch in _chunked(trades, 50):
        params = []
        for t in batch:  # 14 columns id..ts
            params += [str(uuid.uuid4()), user_id, t["coid"], t["strategy"], t["market"],
                       t["side"], t["qty"], t["price"], t["notional"], t["status"],
                       int(t["dry_run"]), t["pnl"], t["tds"], t["ts"]]
        db.query(
            "insert into trades(id,user_id,client_order_id,strategy,market,side,qty,price,"
            "notional,status,dry_run,realized_pnl,tds,ts) values "
            + ",".join("(?,?,?,?,?,?,?,?,?,?,?,?,?,?)" for _ in batch)
            + " on conflict(user_id,client_order_id) do nothing",
            params,
        )

    db.query("delete from positions where user_id = ?", [user_id])
    for batch in _chunked(positions, 50):
        params = []
        for p in batch:
            params += [user_id, p["strategy"], p["market"], p["qty"], p["avg_price"]]
        db.query(
            "insert into positions(user_id,strategy,market,qty,avg_price) values "
            + ",".join("(?,?,?,?,?)" for _ in batch),
            params,
        )

    db.query(
        """insert into equity_snapshots(user_id,equity,free,realized_today,trades_today)
           values (?,?,?,?,?)""",
        [user_id, equity["equity"], equity["free"],
         equity["realized_today"], equity["trades_today"]],
    )
