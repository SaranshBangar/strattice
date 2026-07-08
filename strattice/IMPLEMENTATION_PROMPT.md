# Implementation Prompt — CoinDCX Bot SaaS Platform

> Paste this to an implementation agent. It assumes the repo root is `C:\dev\coindcx`
> (existing single-tenant Python bot in `bot/`, existing single-user dashboard in `web/`).
> Read `strattice/RESEARCH.md` for the full rationale before starting.

---

## Mission

Turn the existing single-tenant CoinDCX trading bot into a multi-tenant SaaS. Users register,
link their **own** CoinDCX account via API keys, pick strategies, and monitor their bots on a
personal dashboard. Monetize with Cashfree subscription tiers. Build everything new in a
**new `strattice/` folder** at the repo root. **Do not touch the existing `web/` folder** — it
stays as the legacy single-user dashboard.

## Locked decisions (do not re-litigate)

1. **No fund custody.** Trading capital stays in each user's own CoinDCX account; the bot
   trades via their API keys. The platform holds no user trading money. "Add money to wallet"
   = the user funds their own CoinDCX wallet; we display balance and link out. Cashfree
   collects **only** subscription fees.
2. **Auto-renew billing** via **Cashfree Subscriptions** (UPI Autopay / eMandate), monthly.
3. **Integration boundary is one Postgres DB** (use Supabase). Next.js and Python never call
   each other — Next.js writes desired state, Python reads it and writes back observed state.

## Tier entitlements (single source of truth — encode as one config object/table)

| Tier    | ₹/mo | Trades/day | Strategy access         | Custom | Dashboard |
| ------- | ---: | ---------: | ----------------------- | :----: | :-------: |
| Free    |    0 |          5 | 1 default strategy      |   ✗    |   basic   |
| Starter |  299 |         50 | 1 default strategy      |   ✗    |   basic   |
| Plus    |  499 |         50 | any 3 of our strategies |   ✗    |     ✓     |
| Pro     |  749 |         75 | all our strategies      |   ✗    |     ✓     |
| Max     |  999 |        100 | all our strategies      |   ✓    |     ✓     |

Enforce in THREE places: UI gating, server-side validation on every mutation, AND the Python
supervisor (re-validate tier caps before building each user's engine). Never trust the client.

---

## Phase 1 — Multi-tenant the Python engine (do this FIRST; it's the risk)

Goal: run N users' bots from one supervisor, each with their own keys/strategies/caps, in
DRY_RUN, writing to Postgres scoped by `user_id`. Prove with 2 fake users before any UI.

1. **Keys as arguments, not globals.** Refactor `bot/client.py` so `Client(api_key, secret)`
   takes credentials per instance instead of reading `config.API_KEY/SECRET_KEY` globals.
   `bot/engine.py:Engine` already takes a `cfg` dict — extend it to accept `api_key`,
   `secret`, and `user_id`.
2. **Move persistence to Postgres, scoped by user_id.** Migrate `bot/audit.py` from SQLite to
   Postgres (or a thin DB layer). Add `user_id` to orders/signals/positions. Keep the exact
   same position model (`(user_id, strategy, market)` key) so engine logic is unchanged.
   Tables per `strattice/RESEARCH.md §5`.
3. **Tier caps from subscription.** When building a user's engine config, set
   `risk.max_trades_per_day` from their tier (5/50/50/75/100) and include only the strategies
   their tier allows. `bot/risk.py` already enforces the daily cap — just feed it the right
   number per user.
4. **Supervisor** (`strattice/worker/supervisor.py` or under `bot/`): each poll, read all
   `bot_state.active = true` users + their `subscriptions` + `user_strategies` + decrypted
   `exchange_credentials` from Postgres; build/refresh one `Engine` per user (reuse the
   `_reconcile` change-detection pattern — add/remove engines as users activate/deactivate);
   run a poll cycle for each; write trades/positions/equity back; update `last_heartbeat` /
   `last_error`. One process, N in-process engines (thread or asyncio task each). _Note in a
   comment: per-user process isolation is the scale-up path; not needed for MVP._
5. **Key decryption.** Read `api_key_enc/secret_enc`, decrypt with AES-256-GCM using a master
   key from env (shared with Next.js). Decrypt in memory at build time only; never log.
6. **Keep DRY_RUN the per-user default.** Live trading requires an explicit per-user switch
   (mirror the existing two-switch safety in `bot/config.py`).

**Phase 1 acceptance:** two seeded users in Postgres (different keys, different tiers, DRY_RUN)
both get bots that respect their own trade caps and strategy sets; toggling `bot_state.active`
or `user_strategies.enabled` is picked up within one poll without restart; trades land in
`trades` with the right `user_id`.

---

## Phase 2 — Next.js platform app (`strattice/`, separate from `web/`)

Stack: Next.js (App Router) + TypeScript + Supabase (Auth + Postgres) + Tailwind. New folder,
own `package.json`.

1. **Auth + registration** (Supabase Auth — email/password or Google). Protected routes.
2. **Link CoinDCX account:** form for API key + secret → encrypt (AES-256-GCM, same master
   key as Python) → store in `exchange_credentials`. UI must instruct: enable trading,
   **disable withdrawals**, IP-allowlist. Never render the secret back.
3. **Strategy selection:** list our strategy templates (the 9 in `bot/strategies/`); user
   enables ones their tier allows, sets market + params → writes `user_strategies`. Gate by
   tier in UI and validate server-side. Max tier: a "custom strategy" builder = pick a base
   template + tune params (jsonb), **not** arbitrary code.
4. **Activate/deactivate bot:** toggle `bot_state.active` + the per-user live/DRY_RUN switch.
5. **Personal dashboard:** read observed state from Postgres — equity curve, open positions,
   recent trades/signals, trades-used-today vs tier cap, bot health (`last_heartbeat`),
   CoinDCX wallet balance (via their keys). Reuse chart approach from `web/` if helpful but do
   not import from it. Basic vs full dashboard per tier.

**Phase 2 acceptance:** a user can register, link keys (stored encrypted), enable allowed
strategies, flip their bot on, and watch the supervisor (Phase 1) start trading their account
in DRY_RUN with results showing live on the dashboard.

---

## Phase 3 — Cashfree subscriptions + entitlements

API base: `https://sandbox.cashfree.com/pg` (test) / `https://api.cashfree.com/pg` (prod).
Headers on every call: `x-client-id`, `x-client-secret`, `x-api-version`. Use raw `fetch` or
the `cashfree-pg` Node SDK; `@cashfreepayments/cashfree-js` for the client checkout.

1. **Create one Plan per paid tier** (₹299/₹499/₹749/₹999 monthly); store `plan_id`s.
2. **Subscribe flow:** create a Subscription against the chosen plan → get the mandate
   authorization link / session → user authorizes (UPI Autopay / eMandate). Store
   `cashfree_sub_id`, `cashfree_plan_id`, `mandate_status` on `subscriptions`.
3. **Webhook route** (`strattice/app/api/cashfree/webhook/route.ts`): read **raw body**
   (`await req.text()`), verify signature =
   `base64(HMAC_SHA256(x-webhook-timestamp + rawBody, CLIENT_SECRET))` constant-time vs
   `x-webhook-signature`, then parse. Confirm the exact scheme against current Cashfree docs.
   Reject invalid. Handle: payment success → set `status=active`, extend
   `current_period_end`; payment failed → grace then downgrade; cancelled/expired → downgrade
   to Free. Idempotent via `billing_events.cashfree_event_id`.
4. **Entitlement gating everywhere:** effective tier = `subscriptions.tier` while
   `status=active AND current_period_end > now()`, else Free. Apply to strategy access, trade
   caps (feeds Phase 1 step 3), and dashboard features. Re-validate in the Python supervisor.
5. **Upgrade/downgrade/cancel** UI calling the Subscriptions manage API.

**Phase 3 acceptance:** in Cashfree sandbox, a user subscribes to ₹499, the mandate authorizes,
the webhook flips them to Plus, they can now enable any 3 strategies and the supervisor lifts
their daily cap to 50; cancelling downgrades them to Free at period end.

---

## Security requirements (non-negotiable — see RESEARCH §6)

- AES-256-GCM for CoinDCX keys at rest; master key in env/KMS only; decrypt in memory only;
  never log secrets or render the secret back.
- Verify every Cashfree webhook signature; reject unsigned/invalid; idempotent processing.
- Server-side entitlement checks on every strategy/activation mutation; supervisor
  re-validates. Never trust the client.
- DRY_RUN default per user; live trading behind an explicit switch.
- Tell users to use withdrawal-disabled, IP-allowlisted keys.

## Out of scope (note as upgrade paths, don't build)

Fund custody/platform wallet (needs PPI license); arbitrary user Python execution (needs
sandboxed workers); per-user container isolation; multi-exchange; mobile app.

## Deliverable layout

```
strattice/
  app/                 # Next.js App Router (auth, dashboard, billing, webhooks)
  lib/                 # crypto (AES-GCM), supabase client, cashfree client, entitlements
  worker/              # Python supervisor + multi-tenant engine glue (or extend bot/)
  db/                  # SQL migrations for the Postgres schema (RESEARCH §5)
  .env.example         # CASHFREE_*, SUPABASE_*, ENCRYPTION_MASTER_KEY, ...
  README.md            # run both runtimes locally
RESEARCH.md            # (already written) architecture & rationale
```

Build Phase 1 → 2 → 3 in order. Keep diffs to `bot/` minimal and backward-compatible (the
existing `web/` dashboard and CLI must keep working in single-tenant mode). Leave a runnable
self-check for any non-trivial new logic (entitlement resolution, webhook signature verify,
key encrypt/decrypt round-trip).
