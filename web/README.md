# CoinDCX Bot Dashboard (PWA)

Mobile-first PWA: bot status, investments (open positions + P&L), recent trades,
and live market charts. Next.js on Vercel. No new database — it reads the bot's
existing SQLite via a tiny read-only JSON server.

```
VPS (systemd)                         Vercel
┌──────────────┐  X-Token   ┌────────────────────────┐
│ bot/server.py│◀───────────│ /api/status (proxy)    │◀── PWA
│  reads bot.db│            │ /api/candles (proxy)   │◀── PWA → CoinDCX public
└──────────────┘            │ passphrase gate (cookie)│
                            └────────────────────────┘
```

## 1. Run the status server on the VPS

It's stdlib-only (no pip installs), **read-only** (never writes to `bot.db`), and
makes **no exchange API calls** — equity is book value (`starting_equity + realized P&L`),
so refreshes are free regardless of DRY_RUN/LIVE.

```bash
# alongside the bot, in /opt/coindcx
BOT_API_TOKEN=$(openssl rand -hex 16) python -m bot.server   # listens :8787
```

Install as a service (see `deploy/coindcx-status.service`):

```bash
sudo cp deploy/coindcx-status.service /etc/systemd/system/
sudo systemctl enable --now coindcx-status
```

**Expose it over HTTPS.** Vercel can't reach a bare VPS port. Use an **ngrok free
static domain** (free, no open inbound port, no domain to buy) so the URL is
**permanent** — full one-time setup in [`deploy/TUNNEL.md`](../deploy/TUNNEL.md):

```bash
# after the one-time setup in deploy/TUNNEL.md, the tunnel runs as a service:
sudo systemctl enable --now coindcx-tunnel    # serves https://you.ngrok-free.app forever
```

> Don't use a Cloudflare *quick* tunnel (`cloudflared tunnel --url ...`): its
> `*.trycloudflare.com` URL is random every run and dies when the terminal closes.
> A *named* Cloudflare tunnel would need a domain you own — a `*.vercel.app` address
> isn't registrable, so ngrok's free static domain is the no-domain path here.

…or put it behind your existing nginx/Caddy with a TLS cert.

## 2. Deploy the PWA to Vercel

- Import the repo, set **Root Directory = `web`**.
- Env vars (Project Settings → Environment Variables):

| var | value |
|-----|-------|
| `APP_PASSPHRASE` | the passphrase you'll type to unlock |
| `BOT_API_URL` | your HTTPS tunnel/proxy URL (no trailing slash) |
| `BOT_API_TOKEN` | **same** token as the bot's `BOT_API_TOKEN` |

Deploy. Open on your phone → unlock → "Add to Home Screen" to install the PWA.

## Local dev

```bash
cd web && npm install
# .env.local: APP_PASSPHRASE / BOT_API_URL / BOT_API_TOKEN  (see .env.example)
npm run dev    # http://localhost:3000
```

Charts pull from CoinDCX's public candle API; the markets shown match the bot's
config (BTC/ETH/XRP/BNB INR). Edit `PAIRS` in `components/MarketChart.tsx` to change.
