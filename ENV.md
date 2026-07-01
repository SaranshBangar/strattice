# How to fill in `.env`

Every secret the bot needs lives in `.env` (gitignored). `config.yaml` holds tunables;
`.env` holds keys and the live-trading switches. **The bot runs fully in DRY_RUN with an
empty `.env`** — you only need keys to place real orders or send Telegram alerts.

Start by copying the template:

```bash
cp .env.example .env
```

Then fill in the variables below.

---

## 1. CoinDCX API keys (needed only for live trading)

`COINDCX_API_KEY`, `COINDCX_SECRET_KEY`

1. Log in to <https://coindcx.com> on desktop.
2. Open the profile menu → **API Dashboard** (direct: <https://coindcx.com/api-dashboard>).
3. Click **Create New API Key**. Complete the 2FA / email / OTP verification it asks for.
4. Set permissions:
   - ✅ **Enable Trading** (required to place orders).
   - ❌ **Withdrawals** — leave OFF. The bot never withdraws; keeping it off means a
     leaked key cannot drain funds.
5. (Recommended) **IP whitelist** — restrict the key to your VPS / home IP.
6. Copy **both** values immediately — the secret is shown **only once**:
   ```ini
   COINDCX_API_KEY=your_key_here
   COINDCX_SECRET_KEY=your_secret_here
   ```
   If you lose the secret, delete the key and make a new one.

> Security: never commit `.env`, never paste keys into `config.yaml` or chat. Rotate the
> key from the same dashboard if it is ever exposed.

---

## 2. Live-trading switches (off by default)

```ini
DRY_RUN=true
LIVE_TRADING_CONFIRM=
```

The bot stays in DRY_RUN (simulated fills, places nothing) unless **both** are set:

```ini
DRY_RUN=false
LIVE_TRADING_CONFIRM=I_UNDERSTAND_LIVE_TRADING
```

Either one alone keeps you safe in DRY_RUN. This double-lock is deliberate — see
`bot/config.py` (`LIVE = (not DRY_RUN) and _LIVE_CONFIRM`).

---

## 3. Telegram alerts (optional)

Without these, alerts just print to the log. To get Telegram pings on trades, blocks,
kill switch, and errors:

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

1. In Telegram, message **@BotFather**, send `/newbot`, follow the prompts. It returns a
   token like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`:
   ```ini
   TELEGRAM_BOT_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
2. Send your new bot any message (this opens the chat so it can reply to you).
3. Message **@userinfobot** to get your numeric chat id, then:
   ```ini
   TELEGRAM_CHAT_ID=123456789
   ```
   For a group, add the bot to the group and use the group's chat id (negative number).

---

## 4. Trade emails (optional)

Emails you on every fill (buy/sell) via the Strattice web app. Without all three, fills
just log/Telegram as before. The bot POSTs each fill to the app, which sends the mail.

`STRATTICE_URL`, `INTERNAL_API_KEY`, `NOTIFY_EMAIL`

```ini
STRATTICE_URL=https://strattice.in          # the deployed web app
INTERNAL_API_KEY=<same value as the web app's env>   # openssl rand -hex 32
NOTIFY_EMAIL=you@example.com                # where fill emails are sent
```

`INTERNAL_API_KEY` must match the web app's, or the app rejects the POST (401) and no
email is sent. The web app also needs its own `SMTP_*` set, or it silently skips mail.

---

## 5. Display rate (optional)

```ini
INR_PER_USDT=85
```

Display only — used by `python -m bot.status` to show ₹ alongside USDT. Does not affect
trading. Update to the live FX rate when it drifts.

---

## Quick checklist

| Variable | Required for | Leave blank to… |
|---|---|---|
| `COINDCX_API_KEY` / `COINDCX_SECRET_KEY` | live trading | stay in DRY_RUN |
| `DRY_RUN` / `LIVE_TRADING_CONFIRM` | going live (both) | stay in DRY_RUN |
| `TELEGRAM_*` | Telegram alerts | log-only alerts |
| `INR_PER_USDT` | ₹ display | default to 85 |

Verify it loaded correctly (no real orders placed):

```bash
python -m bot.status
```
