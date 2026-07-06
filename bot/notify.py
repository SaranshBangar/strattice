"""Telegram alerts via the Bot API + trade-fill emails. No SDK dep - plain POSTs.
Never raises: a notification failure must not crash trading.

Sends run on a single background daemon thread draining a bounded queue, so a slow/down
Telegram API or web app (each POST has a 15s timeout) can never stall the trading poll
loop - callers just enqueue and return. Best-effort: if the process dies between enqueue
and send the alert is lost, which is acceptable since nothing in the trading path depends
on a notification actually landing (kill switch / risk checks don't read the return value).
"""
import logging
import queue
import threading

import requests

from . import config

log = logging.getLogger("notify")

_QUEUE_MAXSIZE = 200
_queue: "queue.Queue[tuple]" = queue.Queue(maxsize=_QUEUE_MAXSIZE)
_worker_lock = threading.Lock()
_worker_started = False


def _ensure_worker() -> None:
    global _worker_started
    if _worker_started:
        return
    with _worker_lock:
        if _worker_started:
            return
        threading.Thread(target=_worker, name="notify-worker", daemon=True).start()
        _worker_started = True


def _worker() -> None:
    while True:
        fn, args = _queue.get()
        try:
            fn(*args)
        except Exception:  # noqa: BLE001 - the worker must never die
            log.exception("notify worker task failed")


def _enqueue(fn, *args) -> None:
    _ensure_worker()
    try:
        _queue.put_nowait((fn, args))
    except queue.Full:
        log.error("notify queue full (%d); dropping alert", _QUEUE_MAXSIZE)


def table(title: str, rows: list[tuple[str, str]]) -> str:
    """Render an aligned key/value block wrapped in ``` so Telegram shows it monospace."""
    w = max(len(k) for k, _ in rows)
    body = "\n".join(f"{k.ljust(w)} : {v}" for k, v in rows)
    return f"```\n{title}\n{body}\n```"


def _email_trade_sync(side: str, market: str, qty: float, price: float, notional: float,
                      strategy: str, dry_run: bool) -> None:
    try:
        requests.post(
            f"{config.STRATTICE_URL}/api/internal/notify",
            headers={"x-internal-key": config.INTERNAL_API_KEY},
            json={"email": config.NOTIFY_EMAIL, "side": side, "market": market, "qty": qty,
                  "price": price, "notional": notional, "strategy": strategy, "dryRun": dry_run},
            timeout=15,
        ).raise_for_status()
    except Exception as e:  # noqa: BLE001 - alerting must never propagate
        log.error("trade email failed: %s", e)


def email_trade(*, side: str, market: str, qty: float, price: float, notional: float,
                strategy: str, dry_run: bool) -> None:
    """Enqueue a fill notification to the web app so it emails NOTIFY_EMAIL. Never raises,
    never blocks the caller."""
    if not (config.STRATTICE_URL and config.INTERNAL_API_KEY and config.NOTIFY_EMAIL):
        return  # ponytail: no creds => skip, like the Telegram log-only path
    _enqueue(_email_trade_sync, side, market, qty, price, notional, strategy, dry_run)


def _send_sync(msg: str) -> None:
    url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(
            url,
            data={"chat_id": config.TELEGRAM_CHAT_ID, "text": msg[:4096], "parse_mode": "Markdown"},
            timeout=15,
        ).raise_for_status()
    except Exception as e:  # noqa: BLE001 - alerting must never propagate
        log.error("Telegram alert failed: %s", e)


def send(msg: str) -> None:
    log.info("ALERT: %s", msg)
    if not (config.TELEGRAM_TOKEN and config.TELEGRAM_CHAT_ID):
        return  # ponytail: no creds => log-only mode, nothing to send
    _enqueue(_send_sync, msg)
