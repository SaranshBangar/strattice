"""One-shot: migrate the repo owner from the single-tenant bot into a regular Strattice user.

Creates (or updates) a real user row with the owner's CoinDCX keys (encrypted), a max-tier
subscription, the 6 actively-advertised strategy templates on their proven default markets,
and bot_state active in DRY_RUN. Optionally imports the single-tenant `data/bot.db` history
(orders -> trades, open positions, one baseline equity snapshot) using the same projection
mapping as supervisor.py — but WITHOUT store.publish(), which would fire a fill-notification
email per imported trade.

Idempotent on re-run: user/credentials/subscription/bot_state/notification_prefs are upserts;
strategies are delete+reinsert (a re-run resets any dashboard customizations back to the 6
defaults); trades dedupe on unique(user_id, client_order_id); positions delete+reinsert; the
equity baseline is written only when the user has no snapshots yet. live stays 0 always —
going LIVE is a deliberate flip in the web UI afterwards.

Env: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN, ENCRYPTION_MASTER_KEY (strattice/.env)
plus the owner's COINDCX_API_KEY / COINDCX_SECRET_KEY (repo-root .env). Optional:
TELEGRAM_CHAT_ID -> notification_prefs (the platform sends via its own shared bot).

Run (from strattice/worker/):
    python migrate_owner.py [--email you@example.com] [--bot-db ../../data/bot.db]
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

import config_gen
import crypto
import store

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / "strattice" / ".env")
load_dotenv(REPO / ".env")  # the owner's single-tenant secrets

# The strategies the platform actively advertises (web/lib/strategies.ts, minus retired
# mean-reversion, experimental hf_forecast and the user-built "custom" template).
ACTIVE_TEMPLATES = ("tsmom", "momentum", "squeeze_breakout",
                    "ma_crossover", "vol_expansion", "supertrend")
TEN_YEARS = 10 * 365 * 86400
STARTING_EQUITY = 1000.0  # supervisor.py / config_gen._BASE baseline


def upsert_user(db: store.D1, email: str, name: str | None) -> str:
    row = db.query("select id from user where email = ?", [email])
    if row:
        return row[0]["id"]
    uid = str(uuid.uuid4())
    now = int(time.time())
    db.query("insert into user(id,name,email,emailVerified,createdAt,updatedAt) values (?,?,?,1,?,?)",
             [uid, name, email, now, now])
    return uid


def upsert_credentials(db: store.D1, uid: str, label: str) -> None:
    api_key = os.getenv("COINDCX_API_KEY", "")
    secret = os.getenv("COINDCX_SECRET_KEY", "")
    if not (api_key and secret):
        raise SystemExit("COINDCX_API_KEY / COINDCX_SECRET_KEY not set — put the owner's "
                         "single-tenant keys in the repo-root .env (see ENV.md)")
    db.query("""insert into exchange_credentials(user_id,api_key_enc,secret_enc,key_label)
                values (?,?,?,?)
                on conflict(user_id) do update set api_key_enc=excluded.api_key_enc,
                  secret_enc=excluded.secret_enc, key_label=excluded.key_label""",
             [uid, crypto.encrypt(api_key), crypto.encrypt(secret), label])


def upsert_subscription(db: store.D1, uid: str) -> None:
    # period_end must be non-NULL and in the future: store._effective_tier() (and the web's
    # effectiveTier()) resolve a NULL/past period_end to 'free'.
    end = int(time.time()) + TEN_YEARS
    db.query("""insert into subscriptions(user_id,tier,status,period_end)
                values (?,'max','active',?)
                on conflict(user_id) do update set tier='max', status='active',
                  period_end=excluded.period_end, updated_at=datetime('now')""",
             [uid, end])


def replace_strategies(db: store.D1, uid: str) -> None:
    db.query("delete from user_strategies where user_id = ?", [uid])
    for i, tpl in enumerate(ACTIVE_TEMPLATES):
        market = config_gen.TEMPLATE_DEFAULTS[tpl]["market"]
        db.query("""insert into user_strategies(id,user_id,template,market,enabled,position)
                    values (?,?,?,?,1,?)""", [str(uuid.uuid4()), uid, tpl, market, i])


def upsert_bot_state(db: store.D1, uid: str) -> None:
    db.query("""insert into bot_state(user_id,active,live) values (?,1,0)
                on conflict(user_id) do update set active=1, live=0,
                  updated_at=datetime('now')""", [uid])


def upsert_notification_prefs(db: store.D1, uid: str) -> bool:
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not chat_id:
        return False
    db.query("""insert into notification_prefs(user_id,email_enabled,telegram_enabled,telegram_chat_id)
                values (?,1,1,?)
                on conflict(user_id) do update set telegram_enabled=1,
                  telegram_chat_id=excluded.telegram_chat_id, updated_at=datetime('now')""",
             [uid, chat_id])
    return True


def import_history(db: store.D1, uid: str, bot_db: Path) -> None:
    """Copy the single-tenant SQLite into the D1 read model, mirroring supervisor._project()
    + store.publish() column-for-column — full history (no `limit 200`) and no trade
    notifications (this is history, not fresh fills)."""
    con = sqlite3.connect(f"file:{bot_db}?mode=ro", uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        orders = con.execute(
            """select client_order_id,strategy,market,side,qty,price,notional,status,
                      dry_run,realized_pnl,tds,ts from orders order by ts"""
        ).fetchall()
        for batch in store._chunked(orders, 50):
            params = []
            for o in batch:  # 14 columns id..ts, same as store.publish
                params += [str(uuid.uuid4()), uid, o["client_order_id"], o["strategy"],
                           o["market"], o["side"], o["qty"], o["price"], o["notional"],
                           o["status"], int(o["dry_run"]), o["realized_pnl"], o["tds"], o["ts"]]
            db.query(
                "insert into trades(id,user_id,client_order_id,strategy,market,side,qty,price,"
                "notional,status,dry_run,realized_pnl,tds,ts) values "
                + ",".join("(?,?,?,?,?,?,?,?,?,?,?,?,?,?)" for _ in batch)
                + " on conflict(user_id,client_order_id) do nothing",
                params,
            )

        pos = con.execute(
            "select strategy,market,qty,avg_price from positions where qty != 0").fetchall()
        db.query("delete from positions where user_id = ?", [uid])
        for batch in store._chunked(pos, 50):
            params = []
            for p in batch:
                params += [uid, p["strategy"], p["market"], p["qty"], p["avg_price"]]
            db.query("insert into positions(user_id,strategy,market,qty,avg_price) values "
                     + ",".join("(?,?,?,?,?)" for _ in batch), params)

        # One baseline snapshot with the supervisor's exact book-equity formula, only if the
        # user has none yet (snapshots are append-only — a re-run must not duplicate it).
        n = db.query("select count(*) n from equity_snapshots where user_id = ?", [uid])[0]["n"]
        if not n:
            total_realized = con.execute(
                "select coalesce(sum(realized_pnl),0) v from orders where status in ('placed','dry_run')"
            ).fetchone()["v"]
            car = con.execute(
                "select coalesce(sum(abs(qty)*avg_price),0) v from positions").fetchone()["v"]
            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            today = con.execute(
                """select count(*) n, coalesce(sum(realized_pnl),0) p from orders
                   where status in ('placed','dry_run') and substr(ts,1,10)=?""", (day,)).fetchone()
            equity = STARTING_EQUITY + total_realized
            db.query("""insert into equity_snapshots(user_id,equity,free,realized_today,trades_today)
                        values (?,?,?,?,?)""",
                     [uid, equity, equity - car, today["p"], today["n"]])
        print(f"imported history: {len(orders)} orders -> trades, {len(pos)} open positions"
              + ("" if n else ", 1 equity baseline"))
    finally:
        con.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--email", default="saranshbangad@gmail.com")
    ap.add_argument("--name", default=None, help="display name for the user row")
    ap.add_argument("--label", default="migrated", help="exchange_credentials.key_label")
    ap.add_argument("--bot-db", type=Path, default=None,
                    help="path to the single-tenant data/bot.db to import history from")
    args = ap.parse_args()

    if not os.getenv("ENCRYPTION_MASTER_KEY"):
        raise SystemExit("set ENCRYPTION_MASTER_KEY (see strattice/.env.example)")
    if args.bot_db is not None and not args.bot_db.exists():
        raise SystemExit(f"--bot-db {args.bot_db}: file not found")

    db = store.connect()
    uid = upsert_user(db, args.email, args.name)
    upsert_credentials(db, uid, args.label)
    upsert_subscription(db, uid)
    replace_strategies(db, uid)
    upsert_bot_state(db, uid)
    telegram = upsert_notification_prefs(db, uid)
    if args.bot_db is not None:
        import_history(db, uid, args.bot_db)

    print(f"migrated {args.email} -> {uid} (tier=max, active=1, live=0 DRY_RUN, "
          f"{len(ACTIVE_TEMPLATES)} strategies)")
    if telegram:
        print("telegram prefs set — /start the platform's bot (shared TELEGRAM_BOT_TOKEN) "
              "or messages won't deliver; your personal bot token is not stored.")
    print(f"""
NEXT: to carry engine state (open positions, risk accounting, order idempotency keys)
into the supervisor-managed engine, on the supervisor host run:
    mkdir -p data/users/{uid} && cp data/bot.db data/users/{uid}/bot.db
Otherwise the first supervisor publish overwrites D1 positions from the fresh (empty)
engine DB and equity restarts at {STARTING_EQUITY:.0f}. Imported trades rows are permanent.
Then: python strattice/worker/supervisor.py""")


if __name__ == "__main__":
    main()
