"""Telegram alerts via the Bot API. No SDK dep — one POST.
Never raises: a notification failure must not crash trading."""
import logging

import requests

from . import config

log = logging.getLogger("notify")


def table(title: str, rows: list[tuple[str, str]]) -> str:
    """Render an aligned key/value block wrapped in ``` so Telegram shows it monospace."""
    w = max(len(k) for k, _ in rows)
    body = "\n".join(f"{k.ljust(w)} : {v}" for k, v in rows)
    return f"```\n{title}\n{body}\n```"


def send(msg: str) -> None:
    log.info("ALERT: %s", msg)
    if not (config.TELEGRAM_TOKEN and config.TELEGRAM_CHAT_ID):
        return  # ponytail: no creds => log-only mode, nothing to send
    url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(
            url,
            data={"chat_id": config.TELEGRAM_CHAT_ID, "text": msg[:4096], "parse_mode": "Markdown"},
            timeout=15,
        ).raise_for_status()
    except Exception as e:  # noqa: BLE001 - alerting must never propagate
        log.error("Telegram alert failed: %s", e)
