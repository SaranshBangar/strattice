# CoinDCX Bot → SaaS Platform: Research & Architecture

Companion to `IMPLEMENTATION_PROMPT.md`. Read this first; it explains _why_ the prompt
is shaped the way it is. Two product decisions are already locked (see §2).

---

## 1. What exists today (the starting point)

The repo is a **single-tenant** Python trading bot:

| Piece            | File                                   | Reality for SaaS                                                                              |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Config + secrets | `bot/config.py`, `config.yaml`, `.env` | **One** user's keys/strategies. Global env vars.                                              |
| Engine loop      | `bot/engine.py`                        | Iterates strategies, re-reads `config.yaml` each poll (live toggles). One process = one user. |
| Exchange client  | `bot/client.py`                        | Signs with `config.API_KEY/SECRET_KEY` (module globals).                                      |
| Risk gate        | `bot/risk.py`                          | `max_trades_per_day`, loss breaker, exposure caps — read from config.                         |
| Persistence      | `data/bot.db` (SQLite)                 | Positions/orders/signals keyed by `(strategy, market)` — **no user_id**.                      |
| Status API       | `bot/server.py`                        | stdlib HTTP, one token, reads the single DB. _(removed 2026-07)_                              |
| Strategies       | `bot/strategies/*.py`                  | Pure functions: candles in → BUY/SELL/HOLD out. 9 modules.                                    |
| Dashboard        | `web/` (Next.js)                       | Single-user PWA hitting `bot/server.py`. _(removed 2026-07 — owner migrated to Strattice; see `worker/migrate_owner.py`)_ |

**The hard part is NOT Next.js or Cashfree.** It is making this single-tenant bot
multi-tenant: per-user keys, per-user isolation, per-user trade caps, per-user DB rows.
Cashfree is a few endpoints; the engine refactor is the real work.

Good news: the engine already re-reads desired state every poll and rebuilds its strategy
set without losing positions (`engine._reconcile`). That same pattern extends cleanly to
"read desired state for N users from a DB each poll."

---

## 2. Locked decisions

1. **No custody.** Trading capital stays in each user's **own CoinDCX account**; the bot
   trades via _their_ API keys. The platform never holds user trading money. Cashfree
   collects **only the subscription fee**. → Avoids PPI/RBI custody licensing, escrow, and
   the AML burden of pooling customer funds. "Add money to their wallets" therefore means
   the user funds their **own CoinDCX wallet directly** (we link out / show balance), not us.

2. **Auto-renew billing** via **Cashfree Subscriptions** (UPI Autopay / eMandate). Monthly
   auto-debit. More work than one-time orders (mandate authorization + lifecycle webhooks)
   but lower churn and matches a subscription product.

3. **Stack (locked during build):** DB = **Cloudflare D1** (SQLite) — both the Python
   supervisor and the Next.js app reach it over the **D1 REST API** (no Workers binding on
   Vercel). Auth = **Better Auth** (email+password) on D1 via Drizzle's `sqlite-proxy`.
   Deploy = **Vercel**. (Earlier drafts said Supabase/Postgres — superseded; the schema and
   `store.py` are now D1/SQLite.)

---

## 3. Tier → entitlement mapping (single source of truth)

| Tier        | ₹/mo | Trades/day | Strategy access             | Custom strats | Dashboard |
| ----------- | ---: | ---------: | --------------------------- | :-----------: | :-------: |
| **Free**    |    0 |      **5** | 1 default strategy only     |       ✗       |   basic   |
| **Starter** |  299 |     **50** | 1 default strategy only     |       ✗       |   basic   |
| **Plus**    |  499 |     **50** | any **3** of our strategies |       ✗       |     ✓     |
| **Pro**     |  749 |     **75** | **all** our strategies      |       ✗       |     ✓     |
| **Max**     |  999 |    **100** | all our strategies          |       ✓       |     ✓     |

**Three enforcement points (defense in depth):**

- **`trades/day`** → maps directly onto the existing `risk.max_trades_per_day`. Set it from
  the user's tier when building their engine config. This is the hard ceiling — already
  implemented in `bot/risk.py:52`.
- **Strategy access** → which strategy templates a user may enable. Gate in the UI **and**
  validate server-side **and** the Python supervisor only loads allowed strategies for the
  tier. Never trust the client.
- **Custom strategies (Max only)** → see §6 security. MVP = _parameterized templates_, not
  arbitrary user Python.

---

## 4. Target architecture

Three components, integrated through **one Postgres database** (Supabase recommended — it's
already available in this environment via MCP, gives you Auth + Postgres + RLS in one).

```
┌─────────────────────┐     writes desired state      ┌──────────────────────┐
│  strattice/ (Next.js)│ ────────────────────────────► │  Postgres (Supabase) │
│  - auth/register    │                                │  users, subs,        │
│  - dashboard        │ ◄──────────────────────────── │  creds(enc), strats, │
│  - Cashfree checkout│       reads trades/status      │  trades, positions   │
│  - webhooks         │                                └──────────┬───────────┘
└─────────────────────┘                                           │ reads desired state
                                                                  │ writes trades/status
                                                       ┌──────────▼───────────┐
                                                       │  Python supervisor    │
                                                       │  (refactored bot/)    │
                                                       │  one Engine per active │
                                                       │  subscriber, tier caps │
                                                       └──────────┬───────────┘
                                                                  │ user API keys
                                                       ┌──────────▼───────────┐
                                                       │  CoinDCX (per user)   │
                                                       └──────────────────────┘
```

**The database is the only integration boundary.** Next.js never calls Python and vice
versa. Next.js writes _desired state_ (tier, enabled strategies, active flag); Python reads
it each poll (exactly like today's `_reconcile`), runs the bots, and writes _observed state_
(trades, positions, equity) back. The dashboard reads observed state. This keeps the two
runtimes fully decoupled and independently deployable.

---

## 5. Data model (Postgres)

```
users(id, email, created_at)                         -- or use Supabase Auth users
exchange_credentials(user_id PK/FK, api_key_enc, secret_enc, key_label, created_at)
subscriptions(user_id, tier, status, cashfree_sub_id, cashfree_plan_id,
              current_period_end, mandate_status, created_at, updated_at)
user_strategies(id, user_id, template, market, params jsonb, enabled, created_at)
bot_state(user_id PK, active bool, last_heartbeat, last_error)   -- desired + liveness
trades(id, user_id, strategy, market, side, qty, price, fee, tds, status, ts)
positions(user_id, strategy, market, qty, avg_price, peak, entry_ts)  -- mirrors audit
equity_snapshots(user_id, equity, free, realized_today, ts)
billing_events(id, user_id, cashfree_event_id, type, raw jsonb, ts)   -- webhook idempotency
```

Notes:

- `trades/positions/signals` = the current SQLite `audit` tables **+ a `user_id` column**.
  Migrate `bot/audit.py` to write these (Postgres) scoped by user_id.
- `subscriptions.current_period_end` is the access truth. Tier entitlements derive from
  `tier` while `status=active AND current_period_end > now()`, else fall back to Free.
- `billing_events` gives **idempotent** webhook handling (Cashfree retries).

---

## 6. Security (do not simplify these)

- **API key encryption at rest.** CoinDCX keys are funds-adjacent. Encrypt with AES-256-GCM;
  the master key lives in env/KMS, never in the DB. Both Next.js (write) and Python (read to
  trade) need the same key. Decrypt only in memory, at trade time. Never log secrets.
- **Tell users to create restricted keys:** trading-enabled, **withdrawals disabled**,
  IP-allowlisted to the supervisor host. Surface this in the "add account" UI.
- **Custom strategies = template params, NOT arbitrary code.** Running user-supplied Python
  in your process is remote code execution. For Max tier, "custom" should mean: pick a base
  template + tune indicator/threshold params (stored in `user_strategies.params` jsonb).
  Arbitrary code would need a sandboxed worker (gVisor/Firecracker/subprocess + seccomp) —
  out of scope for MVP; note it as the upgrade path.
- **Webhook signature verification** (Cashfree, see §7). Reject unsigned/invalid.
- **Server-side entitlement checks** on every strategy enable / activation. The Python
  supervisor re-validates tier caps too — never trust that the UI gated correctly.
- **Keep DRY_RUN as the per-user default.** Live trading should require the user to flip an
  explicit switch, mirroring the bot's existing two-switch safety (`config.py:22-27`).

---

## 7. Cashfree integration facts (current API)

**Product:** Cashfree Subscriptions (recurring). Base URLs: `https://sandbox.cashfree.com/pg`
(test) and `https://api.cashfree.com/pg` (prod). Auth headers on every call:
`x-client-id`, `x-client-secret`, `x-api-version` (e.g. `2023-08-01` / `2025-01-01`).

**Flow:**

1. **Create a Plan per tier once** (₹299/₹499/₹749/₹999, monthly). Store `plan_id`.
2. **Create a Subscription** for the user against a plan → returns an authorization link /
   `subscription_session_id`.
3. **Customer authorizes the mandate** (UPI Autopay / eMandate) via the link or the
   `@cashfreepayments/cashfree-js` checkout.
4. **Cashfree auto-debits** each cycle and fires lifecycle **webhooks**.
5. **Manage** (pause/cancel/upgrade) via the Subscriptions API.

**Webhook verification (PG/Subscriptions scheme):** compute
`base64( HMAC_SHA256( x-webhook-timestamp + rawRequestBody, CLIENT_SECRET ) )` and compare,
constant-time, against the `x-webhook-signature` header. **You must use the raw, unparsed
body** — in Next.js App Router read `await req.text()` and verify before `JSON.parse`.
Confirm the exact header/algorithm against the live docs before shipping (the Payouts product
uses a different scheme).

**Events to handle:** subscription activated, `SUBSCRIPTION_PAYMENT_SUCCESS` (extend
`current_period_end`, set active), `SUBSCRIPTION_PAYMENT_FAILED` (grace then downgrade),
subscription cancelled/expired (downgrade to Free). Make all handlers idempotent via
`billing_events.cashfree_event_id`.

UPI Autopay debit limit is ₹15,000/cycle without re-auth — all tiers are well under it.

**Sources:**

- [Subscription APIs Overview](https://www.cashfree.com/docs/api-reference/payments/latest/subscription/overview)
- [Cashfree Docs](https://www.cashfree.com/docs)
- [cashfree-pg Node SDK](https://github.com/cashfree/cashfree-pg-sdk-nodejs)
- [UPI Autopay](https://www.cashfree.com/upi-autopay/) · [Recurring payments guide](https://www.cashfree.com/blog/what-is-upi-autopay/)
- [@cashfreepayments/cashfree-js](https://www.npmjs.com/~cashfree-payments)

---

## 8. Build order (de-risked)

1. **Multi-tenant the Python engine first** (keys-as-args, user_id in DB, supervisor running
   N engines from Postgres). This is the risky part — prove it with 2 fake users in DRY_RUN.
2. **Next.js auth + add CoinDCX account** (encrypted) + strategy selection writing desired
   state. Watch the supervisor pick them up.
3. **Cashfree Subscriptions** + webhooks + entitlement gating last. Until then, hardcode
   everyone to a tier for testing.

Reasoning: payments are the easy, well-trodden part. If the multi-tenant engine doesn't work,
the payments don't matter. Build the spine before the wallet.

---

## 9. Out of scope for MVP (note, don't build)

- Holding/custodying user funds (see §2 — would need PPI license).
- Arbitrary user-supplied strategy code execution (§6 — needs sandboxing).
- Per-user separate processes/containers (single supervisor with N in-process engines is
  enough until throughput demands isolation; note it as the scale-up path).
- Mobile app, referral system, multi-exchange — all later.
