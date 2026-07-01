# Strattice — Platform setup

Multi-tenant SaaS built on top of the single-tenant trading bot in `../bot/`. Users register,
link their **own** CoinDCX API keys, pick strategies, subscribe to a plan, and watch bots trade
on their own exchange account. We never hold user funds — Cashfree collects only the subscription
fee.

- `RESEARCH.md` — architecture and the locked decisions (read this first).
- `IMPLEMENTATION_PROMPT.md` — the original build brief.
- `DESIGN_PROMPT.md` — paste into claude.ai/design to generate the UI.

---

## 1. Architecture in one picture

```
 Next.js app (platform/web, on Vercel)            Python supervisor (platform/worker, a server)
 ─ register / login (Better Auth)                 ─ reads active users from D1
 ─ link CoinDCX keys (encrypted)        writes    ─ generates a per-user config.yaml
 ─ pick strategies, toggle bot      ┌─ desired ─┐ ─ spawns one `python -m bot.engine` per user
 ─ Cashfree subscribe/webhook       │           │ ─ projects each engine's SQLite back to D1
 ─ dashboard (reads observed) ◄─────┤ Cloudflare├─────────────────────────────────────────────►
                                    │    D1     │              user's own CoinDCX account
                                    └───────────┘                 (trades via their keys)
```

**The D1 database is the only thing the two runtimes share.** The app writes _desired state_
(tier, strategies, bot on/off); the supervisor reads it, runs the bots, and writes _observed
state_ (trades, positions, equity) back for the dashboard. They never call each other.

Why two runtimes: the bot reads its keys + LIVE/DRY_RUN flag as **process globals**, so each
user must be its own OS process. The supervisor manages those processes; Vercel/serverless
can't (it can't spawn long-lived processes), so the supervisor runs on a normal server/VM.

---

## 2. Prerequisites

- **Python 3.12+** and **Node 18+** (Node 20/24 fine).
- A **Cloudflare account** + [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) CLI
  (`npm i -g wrangler`) for D1.
- A **Cashfree** merchant account (sandbox is enough to start) for billing.
- A server/VM to run the Python supervisor (any box that can run Python and reach the internet;
  for development your laptop is fine).
- CoinDCX API keys are supplied by **end users**, not you.

---

## 3. Repo layout

```
bot/                  existing single-tenant engine (unchanged except 2 env-override lines)
platform/
  db/schema.sql       D1 (SQLite) schema incl. Better Auth tables
  worker/             Python supervisor (multi-tenant runtime)
    entitlements.py   tier -> caps/strategies (source of truth)
    crypto.py         AES-256-GCM for keys (matches web/lib/crypto.ts)
    config_gen.py     desired state -> per-user config.yaml
    store.py          Cloudflare D1 over REST
    supervisor.py     the loop: reconcile engines, project state
    seed.py           2 demo users for a DRY_RUN proof
    selfcheck.py      generated config boots the real engine
  web/                Next.js app (Vercel)
    lib/              d1, db(drizzle), auth, crypto, entitlements, cashfree, queries
    app/              routes + server actions
    components/       UI
```

---

## 4. Shared secrets (set these once, use in BOTH runtimes)

Generate them up front — the app encrypts CoinDCX keys that the supervisor must decrypt, so the
**encryption key must be identical** on both sides.

```bash
# 32-byte AES key (base64) — used as ENCRYPTION_MASTER_KEY in web AND worker
python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"

# Better Auth session secret (web only)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## 5. Cloudflare D1 setup

```bash
wrangler login
wrangler d1 create coindcx                 # prints database_id — save it
wrangler d1 execute coindcx --file platform/db/schema.sql --remote
```

Create a Cloudflare **API token** with **D1 Edit** permission (My Profile → API Tokens). You now
have three values used by both runtimes: `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_API_TOKEN`.

> The supervisor and the app both reach D1 via its REST API, so no Workers/Pages runtime is
> needed; the app deploys to Vercel.

---

## 6. Worker (Python supervisor)

```bash
cd platform/worker
pip install -r requirements.txt          # requests, cryptography, pyyaml, dotenv
# also ensure the bot's own deps are installed (repo root):
pip install -r ../../requirements.txt
cp ../.env.example ../.env               # fill CF_*, ENCRYPTION_MASTER_KEY
```

`platform/.env`:

```
CF_ACCOUNT_ID=...
CF_D1_DATABASE_ID=...
CF_API_TOKEN=...
ENCRYPTION_MASTER_KEY=...                 # SAME value as the web app
SUPERVISOR_POLL=30
```

Verify the logic without any infra:

```bash
python crypto.py && python entitlements.py && python config_gen.py
python ../../platform/worker/selfcheck.py   # generated config boots the real engine
```

DRY_RUN proof with 2 demo users (needs D1 + internet for public candles; no real CoinDCX keys):

```bash
python seed.py            # inserts free-demo + max-demo, DRY_RUN, dummy encrypted keys
python supervisor.py      # spawns 2 engines; writes data/users/<uid>/{config.yaml,bot.db}
```

Expect: free user runs 1 strategy capped at 5 trades/day; max user runs 3 at 100/day. Flipping
`bot_state.active`, `user_strategies.enabled`, or `subscriptions.tier` in D1 restarts that user's
engine within one poll. Trades land in the D1 `trades` table with the right `user_id`.

Run it for real: the supervisor is a long-running process — keep it alive with systemd / pm2 /
a container. It picks up real users created by the web app automatically.

---

## 7. Web app (Next.js)

```bash
cd platform/web
npm install                              # uses .npmrc (legacy-peer-deps)
cp .env.example .env.local               # fill everything below
```

`platform/web/.env.local`:

```
BETTER_AUTH_SECRET=...                    # the node-generated secret
BETTER_AUTH_URL=http://localhost:3000     # your app's public URL in prod
CF_ACCOUNT_ID=...
CF_D1_DATABASE_ID=...
CF_API_TOKEN=...
ENCRYPTION_MASTER_KEY=...                 # SAME value as the worker
CASHFREE_APP_ID=...
CASHFREE_SECRET_KEY=...
CASHFREE_MODE=sandbox                     # sandbox | production
CASHFREE_API_VERSION=2025-01-01
```

Run + verify:

```bash
npm run typecheck
npm run check:crypto         # AES-GCM wire format matches Python (python must be on PATH)
npm run check:entitlements   # tier table matches the worker
npm run check:webhook        # Cashfree webhook signature scheme
npm run dev                  # http://localhost:3000
npm run build                # production build
```

Better Auth tables are already in `schema.sql`. If you upgrade Better Auth and its schema
changes, reconcile with `npx @better-auth/cli generate`.

---

## 8. Cashfree (billing)

1. Dashboard → Developers → API Keys: copy App ID + Secret into the web env.
2. Dashboard → Developers → Webhooks: add `https://<your-app>/api/cashfree/webhook`.
3. The webhook is signature-verified and idempotent; it grants/extends access on payment success
   and downgrades on failure/cancel/expiry. **Access is granted only by the webhook**, never the
   client.
4. Before production, send a test event from the dashboard and confirm the event-type strings and
   the `subscriptionsCheckout` SDK method against the live docs (see `web/README.md` → Billing).

Plans are created **inline** per subscription (no separate plan registry to maintain).

---

## 9. Deploy

- **Web → Vercel:** import `platform/web`, set the env vars from §7, deploy. D1 is reached over
  REST so no Cloudflare runtime is needed. Set `BETTER_AUTH_URL` to the deployed URL.
- **Worker → a server/VM:** clone the repo, install deps (§6), set `platform/.env`, and run
  `python platform/worker/supervisor.py` under a process manager. It needs outbound internet
  (CoinDCX + D1 + Cloudflare API) and disk for `data/users/<uid>/`.

---

## 10. Security checklist

- `ENCRYPTION_MASTER_KEY` identical in web + worker; stored in env/secret manager, never in git or
  the DB. CoinDCX keys are encrypted at rest (AES-256-GCM) and decrypted only in memory at trade
  time.
- Tell users to create CoinDCX keys with **trading enabled, withdrawals disabled, IP-allowlisted**
  to the supervisor host.
- Bots default to **DRY_RUN**; LIVE requires an explicit per-user switch.
- Cashfree webhooks are signature-verified; reject anything unsigned/invalid.
- Entitlements are enforced in the UI **and** server actions **and** re-validated by the
  supervisor — never trust the client.

---

## 11. Troubleshooting

| Symptom                                    | Likely cause                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Supervisor: "set CF_ACCOUNT_ID..."         | `platform/.env` not loaded / missing D1 vars                                  |
| `npm run check:crypto` fails               | `ENCRYPTION_MASTER_KEY` differs between sides, or python not on PATH          |
| Engine subprocess exits immediately        | bad per-user config; check `data/users/<uid>/bot.log`                         |
| Dashboard shows nothing after enabling bot | supervisor not running, or user has no linked keys                            |
| Webhook 401                                | signature mismatch — wrong `CASHFREE_SECRET_KEY` or body parsed before verify |
| User stuck on `free` after paying          | webhook URL not configured, or event-type strings differ (see §8)             |
| Better Auth errors on login                | `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` unset, or schema not applied           |

---

## 12. What's not built yet

- Max-tier **custom strategy params** UI (data model supports it).
- LIVE wallet-balance enrichment on the dashboard (currently DRY_RUN book equity).
- Per-user process isolation beyond OS processes (containerize when throughput demands it).
