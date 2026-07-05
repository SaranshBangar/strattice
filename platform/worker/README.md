# Worker — multi-tenant supervisor (Phase 1)

Turns the single-tenant bot in `../../bot/` into a multi-tenant runtime: **one
`python -m bot.engine` subprocess per active user**, each with its own keys, DRY_RUN/LIVE flag,
tier-capped `config.yaml`, and SQLite DB. Postgres is the only thing shared with the Next.js app.

## Why subprocess-per-user

`bot/config.py` reads API keys and the LIVE/DRY_RUN flag as **module globals at import**, so a
single process can't run two users with different keys/live flags. Separate processes give each
user isolated globals for free and contain crashes. (Only change to `bot/`: `config.py` now
honors `CONFIG_PATH` / `BOT_DB_PATH` / `BOT_LOG_PATH` env overrides.)

## Files

| File               | Role                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `entitlements.py`  | Tier → {trades/day, allowed strategies, caps, custom, dashboard}. Source of truth.            |
| `crypto.py`        | AES-256-GCM for CoinDCX keys at rest (format shared with Next.js).                            |
| `config_gen.py`    | Desired state + tier → a valid per-user `config.yaml`.                                        |
| `store.py`         | Cloudflare D1 (REST): read desired state, write observed (trades/positions/equity/heartbeat). |
| `supervisor.py`    | The loop: reconcile engine subprocesses, project SQLite → D1.                                 |
| `seed.py`          | Insert 2 demo users for a DRY_RUN proof.                                                      |
| `selfcheck.py`     | Generated config boots the real engine (no infra).                                            |
| `../db/schema.sql` | D1 (SQLite) schema, incl. Better Auth tables.                                                 |

## Setup

```bash
pip install -r requirements.txt          # requests, cryptography, pyyaml, dotenv
cp ../.env.example ../.env && edit        # CF_ACCOUNT_ID/CF_D1_DATABASE_ID/CF_API_TOKEN + ENCRYPTION_MASTER_KEY
wrangler d1 create coindcx                # once; put the database_id in .env
wrangler d1 execute coindcx --file ../db/schema.sql --remote   # apply schema
```

## Self-checks (no DB / no network)

```bash
python crypto.py && python entitlements.py && python config_gen.py   # run from this dir
python ../../platform/worker/selfcheck.py                            # or: python selfcheck.py from repo root paths
```

## DRY_RUN proof (needs Postgres + internet for public candles; no real keys)

```bash
python seed.py            # 2 demo users (free + max), DRY_RUN, dummy encrypted keys
python supervisor.py      # spawns 2 engines; writes data/users/<uid>/{config.yaml,bot.db}
```

Then verify: the **free** user runs 1 strategy with a 5-trade/day cap; the **max** user runs 3
with 100/day. Flip `bot_state.active`/`user_strategies.enabled`/`subscriptions.tier` in Postgres
→ the supervisor restarts that user's engine within one poll; trades land in `trades` with the
right `user_id`. Positions persist across restarts (keyed in each user's SQLite).

## Known limits (Phase 1)

- Engine restarts on any config/live change (simple + correct; positions persist). Live strategy
  toggling without restart exists in the engine but we don't rely on it here.
- Projected equity is DRY_RUN **book** value; LIVE wallet-balance enrichment is a later add.
- `ponytail:` per-user process isolation scales to modest user counts; containerize per user when
  throughput demands it.
