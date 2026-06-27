"""Config + secrets loading. Tunables from config.yaml, secrets from env/.env only."""
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def load(path: str | None = None) -> dict:
    cfg_path = Path(path) if path else ROOT / "config.yaml"
    with open(cfg_path) as f:
        return yaml.safe_load(f)


# --- secrets / runtime flags (env only) ---
API_KEY = os.getenv("COINDCX_API_KEY", "")
SECRET_KEY = os.getenv("COINDCX_SECRET_KEY", "")

# Live trading requires BOTH the flag off-default AND an explicit confirm string.
DRY_RUN = os.getenv("DRY_RUN", "true").lower() != "false"
_LIVE_CONFIRM = os.getenv("LIVE_TRADING_CONFIRM", "") == "I_UNDERSTAND_LIVE_TRADING"

# Effective mode: live ONLY if DRY_RUN explicitly off AND confirm string present.
LIVE = (not DRY_RUN) and _LIVE_CONFIRM

# Telegram alerts (optional)
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

DB_PATH = ROOT / "data" / "bot.db"
LOG_PATH = ROOT / "data" / "bot.log"

# Display only: USDT->INR rate for /status readouts. INR_PER_USDT in .env is now just a
# fallback used when the live fetch fails (offline, API down). Default 85.
INR_PER_USDT_FALLBACK = float(os.getenv("INR_PER_USDT", "85"))


def inr_per_usdt() -> float:
    """Live USDT->INR from CoinDCX's own public ticker (no key, same rate the bot trades at).
    Falls back to INR_PER_USDT env / 85 if the call fails. ponytail: no caching — /status is
    a one-shot CLI; add an lru_cache+TTL only if a long-lived caller starts hammering it."""
    import requests
    try:
        r = requests.get("https://api.coindcx.com/exchange/ticker", timeout=10)
        r.raise_for_status()
        for t in r.json():
            if t.get("market") == "USDTINR":
                return float(t["last_price"])
    except Exception:
        pass
    return INR_PER_USDT_FALLBACK


def mode_str() -> str:
    if LIVE:
        return "LIVE"
    if not DRY_RUN and not _LIVE_CONFIRM:
        return "DRY_RUN (live requested but LIVE_TRADING_CONFIRM missing -> staying safe)"
    return "DRY_RUN"
