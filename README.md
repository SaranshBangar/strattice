# CoinDCX Trading Bot

Deterministic, multi-strategy crypto trading bot for [CoinDCX](https://coindcx.com).
No LLM in the execution path — every trade decision is plain algorithm code.
**Safety first: DRY_RUN is the default and live trading takes two explicit switches.**

## What it does

- Polls candles on a schedule, runs each enabled strategy, routes signals through one
  risk-managed executor.
- Strategies (each its own module, own config, own position): MA Crossover, RSI
  mean-reversion, Momentum/breakout.
- Every signal + order persisted to SQLite (`data/bot.db`). Idempotent orders.
- Backtester with realistic India costs (0.1% fee + 1% TDS).
- WhatsApp alerts (Twilio) on trades, blocks, kill switch, and errors.

## Setup

```bash
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in keys later; DRY_RUN works with no keys
```

Tune everything in `config.yaml` (strategies, params, capital, **risk limits**).
Secrets live only in `.env` (gitignored) — never in config or code.
**Filling in `.env`:** step-by-step (CoinDCX keys, live switches, Twilio) → [ENV.md](ENV.md).

### Starting small: the ₹5,000 profile

`config.yaml` ships tuned for **~₹5,000 (~$58 USDT)**: 1h candles, 2 strategies at $25
each, a 6-trade/day cap, and per-strategy **stop-losses**. The reasoning matters more
than the numbers — see "Cost drag" below.

## Run (DRY_RUN — safe, places nothing)

```bash
python -m bot.engine     # logs intended trades, executes nothing
python -m bot.status     # quick summary: mode, limits, positions, P&L today
```

## Manual buy/sell test (LIVE — places real orders)

Smoke-tests `Client.create_order` directly, bypassing the bot/executor — **DRY_RUN is
NOT honored, real money.** Needs `COINDCX_API_KEY`/`COINDCX_SECRET_KEY` in `.env`.

```bash
python -m scripts.test_trade --asset BTC --inr 200 --side both   # buy then sell same qty
python -m scripts.test_trade --asset ETH --inr 200 --side buy
python -m scripts.test_trade --asset BTC --qty 0.0005 --side sell
```

`--inr` converts to base qty at the live ticker price; `--qty` sets base amount directly
(overrides `--inr`). Rounds to pair precision, checks `min_quantity`, prompts `YES` before
sending. Run from project root with `-m` (the `bot` import needs it).

## Backtest

```bash
python -m bot.backtest --module ma_crossover --market B-BTC_USDT \
       --interval 1h --limit 1000 --capital 58 --params '{"fast":10,"slow":30}' \
       --stop-loss 0.04 --take-profit 0 --slippage 0.001
python -m bot.backtest --selftest      # verifies the cost math
```

Reports (all after fee + TDS): net P&L, return %, trades, win rate, **profit factor,
expectancy, avg win/loss, max drawdown, annualized Sharpe, total fees+TDS paid,
fees as % of capital, and exposure %**. `--stop-loss/--take-profit/--slippage` model
the same protective exits the live engine runs.

### Cost drag (read this before going live at ₹5k)

Every round trip costs **~1.2%**: 0.1% buy fee + 0.1% sell fee + 1% TDS on the sell.
A strategy must clear that _before_ it makes a rupee. At small capital with frequent
trades, `fees_tds_paid` in the backtest often dwarfs net P&L — that's why this profile
uses 1h candles, a daily trade cap, and take-profits set well above breakeven. **Always
check `fees_pct_of_capital` and `profit_factor` (>1) before enabling a strategy live.**

## Going live (do this deliberately)

Live trading needs **both** of these in `.env` — either one alone stays in DRY_RUN:

```ini
DRY_RUN=false
LIVE_TRADING_CONFIRM=I_UNDERSTAND_LIVE_TRADING
COINDCX_API_KEY=...
COINDCX_SECRET_KEY=...
```

Recommended ramp: backtest → run DRY_RUN against live candles for a few days →
set tiny `risk:` limits and `capital:` → go live → scale up only after reviewing
`data/bot.db` and logs.

### Risk controls (enforced in the executor before every order)

`max_position_size`, `daily_loss_limit` (halts the day), `max_trades_per_day`,
`max_total_capital_at_risk`. Set in `config.yaml`. Per-strategy `stop_loss_pct` /
`take_profit_pct` add protective exits, checked every poll on the close price and
**overriding the strategy signal** (safety first). The engine also runs a startup
sanity check that warns if a strategy's capital can't clear the exchange min-order or
breaches a risk ceiling.

### Kill switch

Create a file named `KILL` in the project root (name from `config.yaml`):

```bash
touch KILL      # cancels open orders, halts trading; delete it to resume
```

## Run as a long-lived process (VPS)

**systemd** (`/etc/systemd/system/coindcx-bot.service`):

```ini
[Unit]
Description=CoinDCX trading bot
After=network-online.target

[Service]
WorkingDirectory=/opt/coindcx
ExecStart=/opt/coindcx/.venv/bin/python -m bot.engine
Restart=always
RestartSec=10
EnvironmentFile=/opt/coindcx/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now coindcx-bot
journalctl -u coindcx-bot -f
```

Restart-safe: risk accounting and positions are rebuilt from `data/bot.db`, and
idempotent order IDs prevent double-submits after a restart.

### First-time deploy (Ubuntu/Debian)

```bash
# 1. Base packages
apt update && apt install -y git python3-venv

# 2. Deploy key (read-only) so the VPS can pull the private repo
ssh-keygen -t ed25519 -f ~/.ssh/id_deploy -N "" -C "coindcx-vps"
cat ~/.ssh/id_deploy.pub          # add this to GitHub → repo → Settings → Deploy keys
printf 'Host github.com\n  IdentityFile ~/.ssh/id_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
ssh -T git@github.com             # expect: "Hi <user>/coindcx! You've successfully authenticated"

# 3. Clone + install (builds venv, writes systemd unit, enables + starts)
git clone git@github.com:<user>/coindcx.git /opt/coindcx
DIR=/opt/coindcx /opt/coindcx/scripts/deploy.sh

# 4. Secrets — boots in safe DRY_RUN until filled (see ENV.md)
nano /opt/coindcx/.env
chmod 600 /opt/coindcx/.env
systemctl restart coindcx-bot
```

### Operating the bot

```bash
systemctl status coindcx-bot        # is it running?
systemctl stop coindcx-bot          # stop  (NOT Ctrl-C — it's a background service)
systemctl start coindcx-bot         # start
systemctl restart coindcx-bot       # restart (apply .env or config changes)
journalctl -u coindcx-bot -f        # tail live logs; exit with q or Ctrl-C
journalctl -u coindcx-bot -n 100    # last 100 log lines
```

`.env` changes only take effect after `systemctl restart coindcx-bot` — the service
reads `EnvironmentFile` at start. `Ctrl-C` does nothing to the service; it only exits
`journalctl`. To disable on boot: `systemctl disable coindcx-bot`.

### Inspecting the database

The bot's full state lives in `data/bot.db` (SQLite). `python -m bot.status` is the
quick summary; these queries dig deeper. Add `-header -column` for readable output.

```bash
cd /opt/coindcx                       # all queries assume the project root

# Quick health: counts of orders / positions / signals
sqlite3 data/bot.db "SELECT (SELECT COUNT(*) FROM orders) o, (SELECT COUNT(*) FROM positions) p, (SELECT COUNT(*) FROM signals) s;"

# Latest decisions — is it alive and what is it deciding? (HOLD/BUY/SELL)
sqlite3 -header -column data/bot.db "SELECT ts,strategy,action,price FROM signals ORDER BY id DESC LIMIT 10;"

# Every trade placed (live + dry-run), newest first
sqlite3 -header -column data/bot.db "SELECT ts,strategy,market,side,qty,price,notional,status,realized_pnl,tds FROM orders ORDER BY id DESC LIMIT 20;"

# LIVE fills only (exclude dry-run + rejected)
sqlite3 -header -column data/bot.db "SELECT ts,strategy,market,side,notional,realized_pnl FROM orders WHERE dry_run=0 AND status='placed' ORDER BY id DESC;"

# Open positions right now (what the bot is holding)
sqlite3 -header -column data/bot.db "SELECT strategy,market,qty,avg_price,peak_price FROM positions WHERE qty!=0;"

# Rejected/failed orders + the reason (debug blocks)
sqlite3 -header -column data/bot.db "SELECT ts,strategy,market,side,status,response FROM orders WHERE status IN ('rejected','error') ORDER BY id DESC LIMIT 20;"

# Realized P&L and TDS to date (placed + dry_run)
sqlite3 -header -column data/bot.db "SELECT ROUND(SUM(realized_pnl),2) pnl, ROUND(SUM(tds),2) tds_paid, COUNT(*) fills FROM orders WHERE status IN ('placed','dry_run');"

# Trades today (UTC) — counts toward max_trades_per_day
sqlite3 data/bot.db "SELECT COUNT(*) FROM orders WHERE status IN ('placed','dry_run') AND substr(ts,1,10)=strftime('%Y-%m-%d','now');"
```

`signals` grows every poll (one row per strategy per cycle) and is just a decision log —
it never affects money or the trade cap; only `orders` and `positions` do. To start fresh
(e.g. after dry-run testing, before going live): stop the bot, then
`sqlite3 data/bot.db "DELETE FROM orders WHERE dry_run=1; DELETE FROM signals; DELETE FROM positions;"`.

### Updating after a push

```bash
cd /opt/coindcx && git pull && systemctl restart coindcx-bot
```

Or install a one-liner `coindcx-update`:

```bash
cat > /usr/local/bin/coindcx-update <<'EOF'
#!/usr/bin/env bash
set -e
cd /opt/coindcx
git pull
.venv/bin/pip install -q -r requirements.txt
systemctl restart coindcx-bot
systemctl status coindcx-bot --no-pager
EOF
chmod +x /usr/local/bin/coindcx-update
```

Then routine updates are just `coindcx-update`.

### Cloudflare Workers + Cron alternative

Workers can't host a persistent Python process or local SQLite, so the model is
different: a **Cron Trigger** fires a stateless worker that runs **one poll cycle**
per invocation.

- Port the per-cycle logic (`Engine.run_once`) to a Worker (TypeScript, or Python
  via Workers Python beta).
- Replace `data/bot.db` with **D1** (SQLite-compatible) for orders/positions and
  **KV/D1** for the kill flag — the same idempotency-by-`client_order_id` design ports directly.
- Secrets via `wrangler secret put`. Schedule with `crontab`-style triggers
  (e.g. `*/5 * * * *`).
- Caveat: cron granularity is ≥1 min and invocations have CPU limits — fine for
  5m+ intervals, not for sub-minute trading. The VPS/systemd path is simpler if you
  want a single always-on process.

## Layout

```
bot/
  config.py     YAML tunables + env secrets, live-mode double-lock
  client.py     signed CoinDCX REST + public candles/markets
  audit.py      SQLite: signals, orders (idempotent), positions
  risk.py       global risk gate
  executor.py   single order path: DRY_RUN, idempotency, risk, P&L accounting
  notify.py     Twilio WhatsApp alerts (log-only without creds)
  engine.py     poll loop
  status.py     /status summary
  backtest.py   historical replay with fee + TDS
  strategies/   base + ma_crossover, rsi, momentum
config.yaml  .env.example  requirements.txt
```

## Notes / deliberate simplifications

- Long-only, flat↔long, full-capital allocation per strategy. Stop-loss/take-profit
  provide the downside cap; add shorting/fractional sizing in `engine.py` if needed.
- Market orders, filled at the signal candle's close for accounting. Add limit/slippage
  modeling when it matters.
- DRY_RUN simulates fills so `/status` and risk accounting stay realistic offline.
- TDS modeled on the sell leg (`backtest.py`); flip `TDS_ON_BUY` to tax both.
