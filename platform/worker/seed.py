"""Seed 2 demo users in D1 for a DRY_RUN proof of the supervisor. Idempotent-ish (re-run
deletes+recreates the demo rows by email). Demo users bypass Better Auth (inserted directly
into the `user` table) — they exist only to exercise the supervisor without the web app.

Both run DRY_RUN with dummy (encrypted) keys: DRY_RUN never calls the signed API and candles
are public, so no real CoinDCX account is needed.

Run:  CF_ACCOUNT_ID=.. CF_D1_DATABASE_ID=.. CF_API_TOKEN=.. ENCRYPTION_MASTER_KEY=.. \
      python platform/worker/seed.py
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv

import crypto
import store

load_dotenv(Path(__file__).resolve().parents[2] / "platform" / ".env")

DEMO = [
    {"email": "free-demo@example.com", "tier": "free",
     "strategies": [("tsmom", "I-ETH_INR", 1),
                    ("momentum", "I-BTC_INR", 1)]},
    {"email": "max-demo@example.com", "tier": "max",
     "strategies": [("tsmom", "I-ETH_INR", 1),
                    ("momentum", "I-BTC_INR", 1),
                    ("squeeze_breakout", "I-DOGE_INR", 1),
                    ("supertrend", "I-BTC_INR", 1)]},
]


def upsert_user(db: store.D1, email: str, tier: str, strategies) -> str:
    row = db.query("select id from user where email = ?", [email])
    uid = row[0]["id"] if row else str(uuid.uuid4())
    now = int(time.time())
    if not row:
        db.query("insert into user(id,email,emailVerified,createdAt,updatedAt) values (?,?,1,?,?)",
                 [uid, email, now, now])

    db.query("""insert into exchange_credentials(user_id,api_key_enc,secret_enc,key_label)
                values (?,?,?,'demo')
                on conflict(user_id) do update set api_key_enc=excluded.api_key_enc,
                  secret_enc=excluded.secret_enc""",
             [uid, crypto.encrypt(f"dummy_key_{email}"), crypto.encrypt(f"dummy_secret_{email}")])
    db.query("""insert into subscriptions(user_id,tier,status) values (?,?,'active')
                on conflict(user_id) do update set tier=excluded.tier, status='active'""",
             [uid, tier])
    db.query("delete from user_strategies where user_id = ?", [uid])
    for i, (tpl, mkt, en) in enumerate(strategies):
        db.query("""insert into user_strategies(id,user_id,template,market,enabled,position)
                    values (?,?,?,?,?,?)""", [str(uuid.uuid4()), uid, tpl, mkt, en, i])
    db.query("""insert into bot_state(user_id,active,live) values (?,1,0)
                on conflict(user_id) do update set active=1, live=0""", [uid])
    return uid


def main() -> None:
    if not os.getenv("ENCRYPTION_MASTER_KEY"):
        raise SystemExit("set ENCRYPTION_MASTER_KEY (see platform/.env.example)")
    db = store.connect()
    for d in DEMO:
        uid = upsert_user(db, d["email"], d["tier"], d["strategies"])
        print(f"seeded {d['email']} tier={d['tier']} -> {uid}")
    print("done. now run: python platform/worker/supervisor.py")


if __name__ == "__main__":
    main()
