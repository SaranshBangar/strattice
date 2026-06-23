"""WhatsApp alerts via Twilio REST. No twilio SDK dep — one signed POST.
Never raises: a notification failure must not crash trading."""
import logging

import requests

from . import config

log = logging.getLogger("notify")


def table(title: str, rows: list[tuple[str, str]]) -> str:
    """Render an aligned key/value block wrapped in ``` so WhatsApp shows it monospace."""
    w = max(len(k) for k, _ in rows)
    body = "\n".join(f"{k.ljust(w)} : {v}" for k, v in rows)
    return f"```\n{title}\n{body}\n```"


def send(msg: str) -> None:
    log.info("ALERT: %s", msg)
    if not (config.TWILIO_SID and config.TWILIO_TOKEN and config.TWILIO_FROM and config.TWILIO_TO):
        return  # ponytail: no creds => log-only mode, nothing to send
    url = f"https://api.twilio.com/2010-04-01/Accounts/{config.TWILIO_SID}/Messages.json"
    try:
        requests.post(
            url,
            data={"From": config.TWILIO_FROM, "To": config.TWILIO_TO, "Body": msg[:1500]},
            auth=(config.TWILIO_SID, config.TWILIO_TOKEN),
            timeout=15,
        ).raise_for_status()
    except Exception as e:  # noqa: BLE001 - alerting must never propagate
        log.error("WhatsApp alert failed: %s", e)
