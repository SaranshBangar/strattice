# CoinDCX Trading Bot

Deterministic, multi-strategy crypto trading bot for [CoinDCX](https://coindcx.com).
No LLM in the execution path — every trade decision is plain algorithm code.
**Safety first: DRY_RUN is the default and live trading takes two explicit switches.**

## What it does

- Polls candles on a schedule, runs each enabled strategy, routes signals through one
  risk-managed executor.
- Strategies (each its own module, own config, own position): daily Time-Series
  Momentum, fast + slow (turtle) Donchian Breakouts, MACD Continuation, a Faber-style
  Trend-Regime holder and an Ichimoku Kumo Breakout — the survivors of six rounds of
  full real-data backtest studies ([research/FINDINGS.md](research/FINDINGS.md));
  validated Supertrend, MA Crossover, Volatility Expansion, Squeeze Breakout and
  risk-adjusted momentum modules plus an experimental Chronos-2 AI forecaster are
  available but not in the default lineup. Mean-reversion and all intraday variants
  are retired: they lose net of India friction.
- Every signal + order persisted to SQLite (`data/bot.db`). Idempotent orders.
- Backtester with realistic India costs (0.1% fee + 1% TDS).
- Telegram alerts on trades, blocks, kill switch, and errors.

## Setup

```bash
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in keys later; DRY_RUN works with no keys
```

Tune everything in `config.yaml` (strategies, params, capital, **risk limits**).
Secrets live only in `.env` (gitignored) — never in config or code.
**Filling in `.env`:** step-by-step (CoinDCX keys, live switches, Telegram) → [ENV.md](ENV.md).

### The daily-trend profile (v6)

`config.yaml` ships with **daily candles and 7 trend strategies — one per INR pair**
(tsmom @ ETH, Donchian 20 @ BTC, turtle-55 @ XRP, MACD @ BNB + SOL, 100-day
trend-regime @ DOGE, Ichimoku @ ADA), each in its own equity sleeve. Burst-entry
engines carry a 7% hard stop + ATR chandelier trail; the regime-holding engines
(trend_regime, ichimoku) exit on their own signal with a wider disaster stop.
Expect a handful of trades per year per strategy — that is the point: at ~1.5-1.7%
round-trip friction, holding winners for weeks is the only backtested way to stay
net-positive. Evidence, methodology and the retirement list:
[research/FINDINGS.md](research/FINDINGS.md).

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
python -m bot.backtest --module tsmom --market I-ETH_INR \
       --interval 1d --limit 1000 --capital 1000 \
       --params '{"lookback":30,"min_return":0.10,"regime_period":50,"expected_move_pct":0.08}' \
       --stop-loss 0.07 --chandelier-k 3.5 --atr-period 14
python -m bot.backtest --module tsmom --interval 1d \
       --data research/data/I-ETH_INR_1d.csv.gz ...   # same, offline (CI-fetched snapshot)
python -m bot.backtest --selftest      # verifies the cost math + static invariants
python -m bot.test_decision_window     # bounded-window parity over real data
python -m bot.test_reliability         # rate limit / breaker / retry / clock / scrubbing
python -m bot.test_fallbacks           # failure-scenario behaviors (see below)
python -m research.run_backtests       # full research grid over research/data/
```

Reports (all after fee + TDS): net P&L, return %, trades, win rate, **profit factor,
expectancy, avg win/loss, max drawdown, annualized Sharpe, total fees+TDS paid,
fees as % of capital, and exposure %**. `--stop-loss/--take-profit/--slippage` model
the same protective exits the live engine runs.

### Cost drag (read this before going live)

Every round trip costs **~1.5-1.7%**: 0.2% fee + 18% GST on each side, plus 1% TDS on
the sell. A strategy must clear that _before_ it makes a rupee. The backtest study in
[research/FINDINGS.md](research/FINDINGS.md) showed intraday configurations paying
87-125% of starting capital in fees+TDS on multi-year windows — that is why v3 trades
daily bars, holds winners for weeks, and never uses take-profits. **Always check
`fees_pct_of_capital` and `profit_factor` (>1) before enabling a strategy live.**

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

**v7 additions** (evidence for every default in
[research/FINDINGS.md](research/FINDINGS.md) v7; reproduce with
`python -m research.portfolio_study`):

- **BTC 100d trend overlay — ON by default** (`portfolio.btc_regime_filter`): new
  entries are blocked while BTC closes under its 100-day SMA. Improved net, profit
  factor and the worst walk-forward fold on both the INR venue and the USDT twins.
  Exits are never touched; the filter fails open if the BTC feed is down.
- Off-by-default knobs, each backtested: `risk.max_new_entries_per_day` (stagger
  correlated same-day deployments), `risk.max_consecutive_losses_halt` (manual-review
  tripwire — see FINDINGS for why it is *not* a performance feature),
  `risk.sleeve_drawdown_derisk_frac` (per-sleeve derisk; the global ladder already
  exists), `risk.asset_buckets`/`exposure_caps` (correlation-bucket exposure cap),
  per-sleeve `vol_target_ann` (vol-targeted sizing: shallower drawdowns for less
  net), `reentry_cooldown_bars`, `entry_slippage_cap_pct`, and `exit_ladder_frac`
  (regime engines: bank part at an ATR trail). The intraday `engine.crash_brake`
  exists but stays off — the study measured it at −107pts net (see FINDINGS v7).

### Failure handling (all tested in `bot/test_fallbacks.py` + `bot/test_reliability.py`)

- **Bad candle data**: every feed is integrity-checked before `decide()` — stale,
  gapped, malformed or misaligned bars mean the market **HOLDs** (nothing trades on
  garbage) with a rate-limited alert; duplicate/out-of-order bars are normalized.
- **Lost order confirmation**: an order POST that dies mid-flight is recorded as
  `error` without touching positions; on the next start a LIVE reconciliation pass asks
  the exchange by `client_order_id` and heals `bot.db` (filled → book the fill;
  never-seen → mark rejected; still open → alert for manual attention).
- **Partial fills**: LIVE fills book the exchange-reported quantity/average price, so
  a partial fill can never desync the book.
- **Balance desync**: LIVE engines compare wallet holdings against the position book
  hourly and alert on any deficit beyond tolerance (detection, never auto-"fixing").
- **Network/exchange trouble**: every call has a timeout; idempotent GETs retry with
  exponential backoff + jitter (429 `Retry-After` honored); repeated 5xx/timeouts open
  a circuit breaker that pauses calls, alerts once, and probes with backoff. A
  client-side token bucket caps request rate. Signed requests refuse to fire if the
  local clock drifts >30s from exchange time (warns at 2s — fix NTP).
- **SQLite**: `bot.db` gets a `quick_check` at boot (corrupt ⇒ halt + alert, never
  trade on a broken book), a daily online-backup snapshot into `data/backups/`
  (7 kept), and a 30s busy timeout for locked-DB contention.
- **Telegram down**: alerts spool to disk and flush when Telegram recovers; trading
  never blocks on notifications.
- **Crash loops**: 5 starts inside 30 min throttles restarts with doubling sleeps and
  one alert (works with or without systemd rate limiting; see the unit below).
- **Kill switch beats everything**: it is checked before every order (entries *and*
  exits), and the halt path completes even if the exchange API is unreachable.

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
# crash-loop brake: max 5 starts per 10 min, then systemd stops retrying until
# `systemctl reset-failed coindcx-bot`. The engine ALSO throttles itself
# (data/engine_starts), so even without these lines a crash loop backs off.
StartLimitIntervalSec=600
StartLimitBurst=5

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
  notify.py     Telegram alerts (log-only without creds)
  engine.py     poll loop
  status.py     /status summary
  backtest.py   historical replay with fee + TDS
  strategies/   base + tsmom, momentum, macd_trend, trend_regime, ichimoku, ma_crossover,
                vol_expansion, squeeze_breakout, supertrend, sharpe_mom, kama_trend,
                adx_trend, hf_forecast (Chronos-2), custom, retired mean-reversion
config.yaml  .env.example  requirements.txt
```

## Notes / deliberate simplifications

- Long-only, flat↔long, full-capital allocation per strategy. Stop-loss/take-profit
  provide the downside cap; add shorting/fractional sizing in `engine.py` if needed.
- Market orders, filled at the signal candle's close for accounting. Add limit/slippage
  modeling when it matters.
- DRY_RUN simulates fills so `/status` and risk accounting stay realistic offline.
- TDS modeled on the sell leg (`backtest.py`); flip `TDS_ON_BUY` to tax both.
