# How to fill in `.env`

Every secret the bot needs lives in `.env` (gitignored). `config.yaml` holds tunables;
`.env` holds keys and the live-trading switches. **The bot runs fully in DRY_RUN with an
empty `.env`** — you only need keys to place real orders or send WhatsApp alerts.

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

## 3. Twilio WhatsApp alerts (optional)

Without these, alerts just print to the log. To get WhatsApp pings on trades, blocks,
kill switch, and errors:

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO`

1. Sign up at <https://www.twilio.com/try-twilio> (free trial works).
2. On the **Twilio Console** home page, copy **Account SID** and **Auth Token**:
   ```ini
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   ```
3. Enable the **WhatsApp Sandbox**: Console → **Messaging → Try it out → Send a WhatsApp
   message**. It shows a sandbox number (usually `+1 415 523 8886`) and a join code.
4. From your own WhatsApp, send `join <code>` to that number to opt in.
5. Fill in (format matters — `whatsapp:` prefix + country code):
   ```ini
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   TWILIO_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
   ```
   `FROM` = the sandbox number; `TO` = your number. For production (no sandbox / no
   24h re-join), apply for a Twilio WhatsApp Sender — not needed to start.

---

## 4. Display rate (optional)

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
| `TWILIO_*` | WhatsApp alerts | log-only alerts |
| `INR_PER_USDT` | ₹ display | default to 85 |

Verify it loaded correctly (no real orders placed):

```bash
python -m bot.status
```
