# Platform web (Phase 2) — Next.js on Vercel + Cloudflare D1

User-facing SaaS: register, link a CoinDCX account, pick strategies, run the bot, watch a
dashboard. Writes **desired state** to D1; the Python supervisor (`../worker`) reads it, runs
the engines, and writes back **observed state** that this app displays. The DB is the only
thing the two share — see `../RESEARCH.md`.

## Stack
- Next.js (App Router) + TypeScript + Tailwind
- **Better Auth** (email+password) on D1 via Drizzle's `sqlite-proxy` driver
- **Cloudflare D1** over the REST API (no Workers binding on Vercel) — `lib/d1.ts`
- AES-256-GCM for CoinDCX keys (`lib/crypto.ts`), byte-compatible with `../worker/crypto.py`

## Routes
| Path | What |
|------|------|
| `/` | Landing (pricing removed — everything is free for now) |
| `/sign-in`, `/sign-up` | Better Auth |
| `/account` | Link CoinDCX keys (encrypted), bot on/off + DRY_RUN/LIVE switch |
| `/strategies` | Card-based template picker with per-template config, editable entry params, deep explanations + a simulated entry/exit preview chart on live candles (`lib/strategy-sim.ts`, `components/StrategyPreview.tsx`) |
| `/strategies/build` | Custom strategy builder: compose entry rules from indicator blocks, live preview + multi-window historic analysis + head-to-head vs the stock templates (`lib/custom-strategy.ts`, `components/StrategyBuilder.tsx`). Defs run live via `bot/strategies/custom.py` - keep the two evaluators in lockstep |
| `/billing` | Free-access notice; cancel button for legacy Cashfree subscriptions only |
| `/dashboard` | Bot health, equity, trades/day vs cap, positions, recent trades |
| `/api/auth/[...all]` | Better Auth handler |
| `/api/cashfree/webhook` | Signed Cashfree webhook → updates tier/status (idempotent) |

Mutations are server actions (`app/actions.ts`); reads are server components hitting D1
(`lib/queries.ts`). Entitlements are enforced server-side here AND re-validated in the worker.

## Setup
```bash
npm install                         # uses .npmrc legacy-peer-deps
cp .env.example .env.local && edit  # BETTER_AUTH_SECRET, CF_*, ENCRYPTION_MASTER_KEY (== worker's)
# apply schema once (from repo root): wrangler d1 execute coindcx --file platform/db/schema.sql --remote
npm run dev
```
`ENCRYPTION_MASTER_KEY` MUST be identical to the worker's, or the supervisor can't decrypt the
keys this app stores.

## Checks
```bash
npm run typecheck          # tsc
npm run check:crypto       # AES-GCM wire format matches Python (needs python on PATH)
npm run check:entitlements # tier table matches worker/entitlements.py
npm run check:webhook      # Cashfree webhook signature scheme
npm run build              # production build
```

## Deploy (Vercel)
Set the env vars in the Vercel project. D1 is reached via the REST API, so no Cloudflare runtime
is needed. (Better Auth runs on the Node.js runtime — the credential crypto uses `Buffer`.)

## Billing (Phase 3 — Cashfree Subscriptions) — DISABLED FOR NOW
Pricing is off: every tier in `lib/entitlements.ts` (and `../worker/entitlements.py`) resolves
to fully-unlocked entitlements, `startSubscriptionAction` is guarded behind `PRICING_ENABLED =
false` in `app/actions.ts`, and the checkout UI is removed. The plumbing below is kept intact
(webhook still processes events for legacy subscriptions; `/billing` still lets them cancel).

- `lib/cashfree.ts`: create/cancel subscription (inline plan per tier), webhook verify.
- Flow: `/billing` → `startSubscriptionAction` creates a subscription + a `pending` row →
  Cashfree JS `subscriptionsCheckout` (UPI Autopay/eMandate) → webhook confirms payment →
  `subscriptions` set `active` + `period_end`. Access is granted ONLY by the webhook.
- Effective tier (web + worker agree): entitled while `period_end > now` and status in
  (`active`,`cancelled`) — cancelling keeps access until period end.
- **Verify against live Cashfree before production:** exact webhook event-type strings and the
  `subscriptionsCheckout` method name. The handler matches on `PAYMENT/SUCCESS`, `PAYMENT/FAIL`,
  `CANCEL`, `EXPIR` substrings (resilient, but confirm payload shape in the dashboard test event).

## Known limits
- Custom strategy defs (template="custom") are validated by `sanitizeCustomDef` on the server
  AND re-clamped in `worker/config_gen.py` - never trust the stored JSON alone.
- Drizzle `sqlite-proxy` maps D1 object-rows by `Object.values` (column order = select order);
  fine for Better Auth's generated queries.
