"""Telegram alerts via the Bot API + trade-fill emails. No SDK dep - plain POSTs.
Never raises: a notification failure must not crash trading.

Sends run on a single background daemon thread draining a bounded queue, so a slow/down
Telegram API or web app (each POST has a 15s timeout) can never stall the trading poll
loop - callers just enqueue and return.

Durability: a Telegram send that fails is SPOOLED to disk (data/alerts_spool.jsonl,
bounded) and flushed after the next successful send - so an outage delays alerts instead
of losing them, and a process restart mid-outage still delivers once Telegram is back.
Trading never waits on any of this.

Security: every outgoing message is scrubbed of registered secrets (API keys, tokens)
before it is logged or sent - an exception string that embeds a header or body can never
leak a credential into Telegram or the log file.
"""
import json
import logging
import queue
import threading
import time
from datetime import datetime, timezone

import requests

from . import config
from .reliability import register_secrets, scrub

log = logging.getLogger("notify")

register_secrets(config.TELEGRAM_TOKEN, config.INTERNAL_API_KEY,
                 config.API_KEY, config.SECRET_KEY)

_QUEUE_MAXSIZE = 200
_queue: "queue.Queue[tuple]" = queue.Queue(maxsize=_QUEUE_MAXSIZE)
_worker_lock = threading.Lock()
_worker_started = False

_SPOOL_MAX_LINES = 500     # bounded: a week-long outage keeps the newest alerts, not 10GB
_FLUSH_BATCH = 20          # flushed per successful send; stays inside Telegram rate limits
_spool_lock = threading.Lock()


def _spool_path():
    # Lives next to the bot's DB so each SaaS per-user subprocess spools separately.
    return config.DB_PATH.parent / "alerts_spool.jsonl"


def _spool_append(msg: str) -> None:
    """Persist an undeliverable alert. Keeps at most _SPOOL_MAX_LINES newest entries."""
    try:
        p = _spool_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with _spool_lock:
            lines = []
            if p.exists():
                lines = p.read_text(encoding="utf-8").splitlines()
            lines.append(json.dumps(
                {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "msg": msg}))
            p.write_text("\n".join(lines[-_SPOOL_MAX_LINES:]) + "\n", encoding="utf-8")
    except Exception:  # noqa: BLE001 - spooling is best-effort, never propagate
        log.exception("failed to spool alert")


def _spool_flush() -> None:
    """Deliver up to _FLUSH_BATCH spooled alerts (oldest first), each stamped with its
    original enqueue time. Called after a successful live send, i.e. only when Telegram
    is demonstrably back. Stops at the first failure (leaves the rest spooled)."""
    try:
        p = _spool_path()
        with _spool_lock:
            if not p.exists():
                return
            lines = [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if not lines:
            return
        sent = 0
        for ln in lines[:_FLUSH_BATCH]:
            try:
                item = json.loads(ln)
            except ValueError:
                sent += 1  # corrupted line - drop it rather than wedging the spool
                continue
            if not _post_telegram(f"[delayed {item.get('ts', '?')}]\n{item.get('msg', '')}"):
                break
            sent += 1
            time.sleep(0.5)  # be gentle: Telegram allows ~1 msg/s per chat
        if sent:
            with _spool_lock:
                remaining = [ln for ln in p.read_text(encoding="utf-8").splitlines()
                             if ln.strip()][sent:]
                if remaining:
                    p.write_text("\n".join(remaining) + "\n", encoding="utf-8")
                else:
                    p.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        log.exception("alert spool flush failed")


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


def _md_escape(s: str) -> str:
    """Escape the characters Telegram's legacy Markdown treats as formatting, so a value
    like an engine name (tsmom_0) or a market (I-BTC_INR) renders literally instead of
    accidentally starting italics/code."""
    out = str(s)
    for ch in ("\\", "_", "*", "`", "["):
        out = out.replace(ch, "\\" + ch)
    return out


def bullets(title: str, rows: list[tuple[str, str]]) -> str:
    """A simple, bullet-pointed alert: a bold title over one '• key: value' line per row.
    Replaces the old monospaced table() - easier to scan on a phone."""
    body = "\n".join(f"• {_md_escape(k)}: {_md_escape(v)}" for k, v in rows)
    return f"*{_md_escape(title)}*\n{body}"


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
        log.error("trade email failed: %s", scrub(str(e)))


def email_trade(*, side: str, market: str, qty: float, price: float, notional: float,
                strategy: str, dry_run: bool) -> None:
    """Enqueue a fill notification to the web app so it emails NOTIFY_EMAIL. Never raises,
    never blocks the caller."""
    if not (config.STRATTICE_URL and config.INTERNAL_API_KEY and config.NOTIFY_EMAIL):
        return  # ponytail: no creds => skip, like the Telegram log-only path
    _enqueue(_email_trade_sync, side, market, qty, price, notional, strategy, dry_run)


def _post_telegram(msg: str) -> bool:
    """One Telegram POST. True on success. Never raises."""
    url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(
            url,
            data={"chat_id": config.TELEGRAM_CHAT_ID, "text": msg[:4096], "parse_mode": "Markdown"},
            timeout=15,
        ).raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001 - alerting must never propagate
        log.error("Telegram alert failed: %s", scrub(str(e)))
        return False


def _send_sync(msg: str) -> None:
    if _post_telegram(msg):
        _spool_flush()  # Telegram is up - deliver anything an earlier outage spooled
    else:
        _spool_append(msg)


def send(msg: str) -> None:
    msg = scrub(msg)
    log.info("ALERT: %s", msg)
    if not (config.TELEGRAM_TOKEN and config.TELEGRAM_CHAT_ID):
        return  # ponytail: no creds => log-only mode, nothing to send
    _enqueue(_send_sync, msg)
