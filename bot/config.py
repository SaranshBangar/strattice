"""Config + secrets loading. Tunables from config.yaml, secrets from env/.env only."""
import os
import time
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def load(path: str | None = None) -> dict:
    # Default honors CONFIG_PATH env so a per-user subprocess (SaaS supervisor) loads its own
    # config.yaml without code changes — sizing/engine/_reconcile all call load() with no path.
    cfg_path = Path(path or os.getenv("CONFIG_PATH") or (ROOT / "config.yaml"))
    with open(cfg_path) as f:
        cfg = yaml.safe_load(f)
    if (isinstance(cfg, dict) and exchange(cfg) == "binance"
            and cfg.get("quote_currency", "INR") == "INR"):
        cfg = _inr_config_on_binance(cfg)
    return cfg


def _usdt_twin(market):
    """I-BTC_INR -> B-BTC_USDT (Binance has no INR book). Other ids pass through."""
    if isinstance(market, str) and market.startswith("I-") and market.endswith("_INR"):
        return "B-" + market[2:-len("_INR")] + "_USDT"
    return market


def _inr_config_on_binance(cfg: dict) -> dict:
    """Run the repo's INR (CoinDCX) config on Binance: every INR pair trades its USDT twin,
    the quote is USDT, and the CoinDCX fee/TDS rates give way to Binance's defaults
    (bot/costs.EXCHANGE_DEFAULTS). Per-user configs from the worker are already
    USDT-shaped and never reach here."""
    cfg = dict(cfg)
    cfg["quote_currency"] = "USDT"
    cfg["strategies"] = [{**s, "market": _usdt_twin(s.get("market"))}
                         for s in cfg.get("strategies") or []]
    f = (cfg.get("portfolio") or {}).get("btc_regime_filter")
    if isinstance(f, dict):
        cfg["portfolio"] = {**cfg["portfolio"],
                            "btc_regime_filter": {**f, "market": _usdt_twin(f.get("market"))}}
    c = {k: v for k, v in (cfg.get("costs") or {}).items() if k not in ("fee_rate", "tds_rate")}
    cfg["costs"] = c
    return cfg


# --- secrets / runtime flags (env only) ---
API_KEY = os.getenv("COINDCX_API_KEY", "")
SECRET_KEY = os.getenv("COINDCX_SECRET_KEY", "")
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_SECRET_KEY = os.getenv("BINANCE_SECRET_KEY", "")


def exchange(cfg: dict | None = None) -> str:
    """Which exchange this process trades: config.yaml `exchange:` (coindcx | binance),
    overridable by the EXCHANGE env var. Defaults to coindcx so existing deployments
    are unchanged. Market ids keep one spelling on both venues: I-BTC_INR (CoinDCX INR),
    B-BTC_USDT (USDT pairs - CoinDCX's B- markets, or Binance's BTCUSDT)."""
    env = os.getenv("EXCHANGE", "").strip().lower()
    if env:
        return env
    if cfg is None:
        try:
            cfg = load()
        except Exception:  # noqa: BLE001 - no config file (tests, tools) -> default
            cfg = {}
    return str((cfg or {}).get("exchange") or "coindcx").lower()

# Live trading requires BOTH the flag off-default AND an explicit confirm string.
DRY_RUN = os.getenv("DRY_RUN", "true").lower() != "false"
_LIVE_CONFIRM = os.getenv("LIVE_TRADING_CONFIRM", "") == "I_UNDERSTAND_LIVE_TRADING"

# Effective mode: live ONLY if DRY_RUN explicitly off AND confirm string present.
LIVE = (not DRY_RUN) and _LIVE_CONFIRM

# Telegram alerts (optional)
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# The SaaS supervisor respawns a user's engine subprocess whenever their config changes
# (e.g. a strategy is added/removed/edited). That recycle would otherwise fire a fresh
# "bot started" alert on every strategy tweak, so the supervisor sets this flag on a
# config-only restart to keep the start alert quiet. A genuine first start / go-live is
# left un-set so those DO still alert.
SUPPRESS_START_ALERT = os.getenv("BOT_SUPPRESS_START_ALERT", "").lower() in (
    "1",
    "true",
    "yes",
)

# Trade emails via the web app (optional). Single-user bot has no platform account, so it
# emails NOTIFY_EMAIL directly through the app's /api/internal/notify. All three required.
STRATTICE_URL = os.getenv("STRATTICE_URL", "").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "")

# BOT_DB_PATH/BOT_LOG_PATH env overrides let the SaaS supervisor give each user subprocess its
# own SQLite + log (data/users/<uid>/). Default unchanged for single-tenant use.
DB_PATH = Path(os.getenv("BOT_DB_PATH") or (ROOT / "data" / "bot.db"))
LOG_PATH = Path(os.getenv("BOT_LOG_PATH") or (ROOT / "data" / "bot.log"))

# Display only: USDT->INR rate for /status readouts. INR_PER_USDT in .env is now just a
# fallback used when the live fetch fails (offline, API down). Default 85.
INR_PER_USDT_FALLBACK = float(os.getenv("INR_PER_USDT", "85"))


_INR_PER_USDT_TTL = 30.0  # seconds
_inr_per_usdt_cache: tuple[float, float] | None = None  # (value, fetched_at)


def inr_per_usdt() -> float:
    """Live USDT->INR from CoinDCX's own public ticker (no key, same rate the bot trades at).
    Falls back to INR_PER_USDT env / 85 if the call fails. Display-only value (never used in
    sizing/risk) - short TTL cache so frequent callers (e.g. `python -m bot.status`) don't
    hammer the ticker endpoint."""
    global _inr_per_usdt_cache
    now = time.monotonic()
    if _inr_per_usdt_cache is not None and now - _inr_per_usdt_cache[1] < _INR_PER_USDT_TTL:
        return _inr_per_usdt_cache[0]
    import requests
    value = INR_PER_USDT_FALLBACK
    try:
        r = requests.get("https://api.coindcx.com/exchange/ticker", timeout=10)
        r.raise_for_status()
        for t in r.json():
            if t.get("market") == "USDTINR":
                value = float(t["last_price"])
                break
    except Exception:
        pass
    _inr_per_usdt_cache = (value, now)
    return value


def mode_str() -> str:
    if LIVE:
        return "LIVE"
    if not DRY_RUN and not _LIVE_CONFIRM:
        return "DRY_RUN (live requested but LIVE_TRADING_CONFIRM missing -> staying safe)"
    return "DRY_RUN"
