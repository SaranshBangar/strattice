"""Recovery + drift detection between bot.db and the exchange. LIVE-mode only paths.

Two failure classes are handled here, each a scenario the executor alone can't fix:

1) LOST ORDER CONFIRMATION: the order POST went out, the network died before the reply.
   The executor records status='error' and does NOT touch position state (correct: it
   doesn't know). But the exchange may have filled it - bot.db is now wrong. On boot,
   heal_lost_confirmations() asks the exchange about every recent 'error' order by our
   own client_order_id (the idempotency key survives crashes precisely for this):
     - exchange has it, filled  -> replay the fill into orders/positions (heal the book)
     - exchange never saw it    -> mark the row 'rejected' (definitively not placed)
     - exchange has it, open    -> alert (a stale live order needs a human/cancel)

2) BALANCE DESYNC: bot.db says we hold X of an asset; the wallet disagrees (a manual
   trade in the app, a healed-over bug, withdrawal by the user). check_balance_drift()
   compares per-asset wallet holdings against the summed open positions and returns
   alert lines for any deficit beyond tolerance. Detection only - it never "fixes" a
   position by inventing fills; the human decides (or the kill switch does).
"""
from __future__ import annotations

import logging

from . import audit
from .client import Client, CoinDCXError
from .executor import _apply_fill

log = logging.getLogger("reconcile")

_FILLED_STATES = {"filled", "partially_filled", "partial_fill", "partially_cancelled"}
_DEAD_STATES = {"cancelled", "rejected", "expired"}


def _order_payload(resp: dict) -> dict:
    """The status endpoint may wrap the order as {"orders": [..]} or return it flat."""
    if isinstance(resp, dict) and isinstance(resp.get("orders"), list) and resp["orders"]:
        return resp["orders"][0] or {}
    return resp if isinstance(resp, dict) else {}


def _fill_from(resp: dict) -> tuple[float, float, str]:
    """(filled_qty, avg_price, exchange_status) out of an order-status payload.
    Field names vary across CoinDCX endpoints; try the documented ones in order."""
    o = _order_payload(resp)
    status = str(o.get("status", "")).lower()
    qty = 0.0
    for k in ("filled_quantity", "executed_quantity", "total_quantity"):
        try:
            v = float(o.get(k) or 0.0)
        except (TypeError, ValueError):
            continue
        if v > 0:
            qty = v
            break
    price = 0.0
    for k in ("avg_price", "average_price", "price_per_unit", "price"):
        try:
            v = float(o.get(k) or 0.0)
        except (TypeError, ValueError):
            continue
        if v > 0:
            price = v
            break
    return qty, price, status


def resolve_one(client: Client, row) -> tuple[str, str | None]:
    """Resolve ONE 'error' order row against the exchange. Returns (outcome, line):
       outcome  'healed'      the order filled; bot.db was updated to match
                'not_found'   the exchange never saw it; row marked rejected (retry-safe)
                'dead'        exchange says cancelled/rejected with no fill; row rejected
                'manual'      order exists in an open/unknown state; needs a human
                'lookup_failed' the status call itself failed; try again later
       line is a human-readable description (None for lookup_failed)."""
    coid = row["client_order_id"]
    try:
        resp = client.order_status(client_order_id=coid)
    except CoinDCXError as e:
        log.warning("reconcile: status lookup failed for %s: %s", coid, e)
        return "lookup_failed", None
    if resp is None:
        # Definitive: the exchange never saw this order. Close the question.
        audit.heal_order(coid, status="rejected",
                         response={"reconciled": "exchange has no such order"})
        return "not_found", (f"{row['strategy']} {row['market']} {row['side']}: "
                             "never reached the exchange -> marked rejected")
    qty, price, status = _fill_from(resp)
    if status in _DEAD_STATES and qty <= 0:
        audit.heal_order(coid, status="rejected",
                         response={"reconciled": f"exchange status {status}"})
        return "dead", (f"{row['strategy']} {row['market']} {row['side']}: "
                        f"exchange says {status} -> marked rejected")
    if qty > 0 and price > 0 and (status in _FILLED_STATES or status in _DEAD_STATES):
        # The order DID fill (fully or partially) while we thought it errored:
        # replay the fill into the position book exactly like the executor would.
        old_qty, old_avg = audit.get_position(row["strategy"], row["market"])
        new_qty, new_avg, realized = _apply_fill(old_qty, old_avg, row["side"], qty, price)
        from . import costs
        tds_paid = costs.tds(row["side"], qty * price)
        audit.heal_order(coid, status="placed", qty=qty, price=price,
                         notional=qty * price, realized_pnl=realized, tds=tds_paid,
                         response={"reconciled": f"filled on exchange ({status})"})
        if old_qty == 0 and new_qty > 0:
            peak, entry_ts = price, 0
        elif new_qty == 0:
            peak, entry_ts = 0.0, 0
        else:
            peak, entry_ts = audit.get_meta(row["strategy"], row["market"])
            peak = max(peak, price)
        audit.set_position(row["strategy"], row["market"], new_qty, new_avg, peak, entry_ts)
        return "healed", (f"{row['strategy']} {row['market']} {row['side']} qty={qty} "
                          f"@{price}: FILLED on exchange -> book healed "
                          f"(pos {old_qty} -> {new_qty})")
    # Anything else (open/init/unknown status) needs eyes, not automation.
    return "manual", (f"{row['strategy']} {row['market']} {row['side']} "
                      f"(coid {coid[:12]}…): exchange status {status or 'unknown'} "
                      "- manual check needed")


def heal_lost_confirmations(client: Client, *, days: int = 3) -> list[str]:
    """Boot reconciliation pass. Returns human-readable lines describing every change
    made (empty = book was already consistent). Never raises: a reconcile failure must
    not stop the engine from starting - it logs and moves on (the next boot retries)."""
    changes: list[str] = []
    try:
        rows = audit.orders_with_status("error", days=days)
    except Exception:  # noqa: BLE001
        log.exception("reconcile: could not read error orders")
        return changes
    for row in rows:
        _outcome, line = resolve_one(client, row)
        if line:
            changes.append(line)
    return changes


def resolve_stuck_order(client: Client, coid: str) -> str:
    """On-demand resolution for the executor: an order row in status 'error' occupies
    the idempotency key, which would otherwise block ANY retry of the same logical
    decision (e.g. a protective exit re-fired on the same bar). Ask the exchange:
    returns 'retry' ONLY when the outcome is now definitively 'the exchange has no such
    fill' (row moved to rejected), else 'resolved' (healed - do not re-place) or
    'unknown' (leave it alone; a blind resend could double-fire)."""
    try:
        rows = [r for r in audit.orders_with_status("error", days=30)
                if r["client_order_id"] == coid]
    except Exception:  # noqa: BLE001
        return "unknown"
    if not rows:
        return "unknown"
    outcome, line = resolve_one(client, rows[0])
    if line:
        log.warning("RECONCILED (on demand): %s", line)
    if outcome in ("not_found", "dead"):
        return "retry"
    if outcome == "healed":
        return "resolved"
    return "unknown"


def _base_currency(client: Client, market: str) -> str | None:
    m = client.markets().get(market) or {}
    v = m.get("target_currency_short_name")
    return str(v) if v else None


def check_balance_drift(client: Client, *, tolerance_frac: float = 0.02,
                        min_notional_ignored: float = 1.0) -> list[str]:
    """Compare bot.db open positions against real wallet holdings per base asset.
    Returns alert lines for each asset where the wallet holds LESS than the bot's book
    (beyond tolerance) - the dangerous direction: a SELL the bot later fires would fail
    or dump someone else's coins. Wallet holding MORE than the book is normal (the user's
    own funds share the account) and is not flagged. Never raises."""
    problems: list[str] = []
    try:
        positions = audit.open_positions()
        if not positions:
            return problems
        held: dict[str, float] = {}
        for p in positions:
            base = _base_currency(client, p["market"])
            if base is None:
                continue
            held[base] = held.get(base, 0.0) + max(0.0, p["qty"])
        if not held:
            return problems
        balances = {str(b.get("currency")): float(b.get("balance", 0) or 0)
                    + float(b.get("locked_balance", 0) or 0)
                    for b in client.balances()}
        for base, book_qty in held.items():
            if book_qty <= 0:
                continue
            wallet = balances.get(base, 0.0)
            deficit = book_qty - wallet
            if deficit > book_qty * tolerance_frac and deficit > 0:
                problems.append(
                    f"{base}: bot book holds {book_qty:.8g} but wallet has {wallet:.8g} "
                    f"(deficit {deficit:.8g}) - positions and wallet have diverged")
    except Exception:  # noqa: BLE001 - drift detection must never break the loop
        log.exception("balance drift check failed")
    return problems
