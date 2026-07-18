"""Single risk-managed order path. EVERY order in the system goes through place().

Guarantees:
- DRY_RUN by default: logs intent, places nothing, but still simulates fills so
  risk accounting and /status stay realistic.
- Idempotent: client_order_id = deterministic hash of (strategy, market, candle_ts, side).
  The same logical decision on the same candle can never be submitted twice, even after
  a crash/restart (DB UNIQUE constraint is the backstop).
- Risk-gated: RiskManager.check() runs before any live or simulated fill.
"""
import datetime
import hashlib
import logging

from . import audit, config, costs, notify
from .client import Client, CoinDCXError
from .risk import RiskManager

log = logging.getLogger("executor")


def _coid(strategy: str, market: str, candle_ts: int, side: str) -> str:
    raw = f"{strategy}:{market}:{candle_ts}:{side}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _apply_fill(old_qty: float, old_avg: float, side: str, qty: float, price: float):
    """Return (new_qty, new_avg, realized_pnl_net_of_fee) for a fill. Signed qty: +long/-short.

    Fee+GST comes from costs.py so DRY_RUN P&L matches live. TDS is NOT folded in here
    (it's a withholding, not P&L) — the executor records it as a separate cash drag.
    """
    signed = qty if side == "buy" else -qty
    fee = costs.trading_fee(qty * price)

    if old_qty == 0 or (old_qty > 0) == (signed > 0):
        # opening or adding in the same direction -> no realized P&L
        new_qty = old_qty + signed
        new_avg = (old_avg * abs(old_qty) + price * abs(signed)) / abs(new_qty)
        return new_qty, new_avg, -fee

    # reducing / closing / flipping
    closing = min(abs(signed), abs(old_qty))
    realized = (price - old_avg) * closing * (1 if old_qty > 0 else -1)
    new_qty = old_qty + signed
    if abs(signed) <= abs(old_qty):
        new_avg = 0.0 if new_qty == 0 else old_avg
    else:
        new_avg = price  # flipped to the other side
    return new_qty, new_avg, realized - fee


class Executor:
    def __init__(self, cfg: dict, client: Client, risk: RiskManager):
        self.cfg = cfg
        self.client = client
        self.risk = risk

    @staticmethod
    def _record(o: dict, reuse_row: bool) -> None:
        """Persist an order outcome. A retry that reuses a reconciled coid UPDATES the
        existing row (the UNIQUE key would reject a second insert); everything else
        inserts normally."""
        if reuse_row:
            audit.heal_order(o["client_order_id"], status=o["status"], qty=o["qty"],
                             price=o["price"], notional=o["notional"],
                             realized_pnl=o.get("realized_pnl", 0.0),
                             tds=o.get("tds", 0.0), response=o.get("response", {}))
        else:
            audit.log_order(o)

    def place(self, *, strategy: str, market: str, side: str, qty: float,
              price: float, candle_ts: int) -> dict:
        coid = _coid(strategy, market, candle_ts, side)
        reuse_row = False
        prior = audit.order_status_of(coid)
        if prior is not None:
            # An 'error' row means the last attempt's outcome is UNKNOWN - it occupies
            # the idempotency key and would block e.g. a protective exit from ever being
            # retried on this bar. Resolve it against the exchange first: only a
            # definitive "no such fill" clears the key for a retry; a fill heals the
            # book instead, and an unknown answer keeps the conservative skip (a blind
            # resend could double-fire).
            if prior == "error" and config.LIVE:
                from . import reconcile  # local import avoids a module cycle
                outcome = reconcile.resolve_stuck_order(self.client, coid)
                if outcome == "retry":
                    reuse_row = True
                    log.warning("retrying %s %s %s after reconciling failed attempt "
                                "(coid=%s)", strategy, market, side, coid)
                else:
                    log.info("skip %s %s %s: prior attempt %s (coid=%s)",
                             strategy, market, side, outcome, coid)
                    return {"status": "skipped", "reason": outcome, "client_order_id": coid}
            else:
                log.info("idempotent skip %s %s %s (coid=%s)", strategy, market, side, coid)
                return {"status": "skipped", "client_order_id": coid}

        qty = self.client.round_qty(market, qty)
        notional = qty * price
        old_qty, old_avg = audit.get_position(strategy, market)
        signed = qty if side == "buy" else -qty
        increasing = old_qty == 0 or (old_qty > 0) == (signed > 0)
        new_exposure = notional if increasing else 0.0

        decision = self.risk.check(notional, new_exposure, strategy=strategy,
                                   market=market, increasing=increasing)
        if not decision.ok:
            audit.log_order({
                "client_order_id": coid, "strategy": strategy, "market": market,
                "side": side, "qty": qty, "price": price, "notional": notional,
                "status": "rejected", "dry_run": not config.LIVE,
                "response": {"reason": decision.reason},
            })
            log.warning("RISK BLOCK %s %s %s: %s", strategy, market, side, decision.reason)
            notify.send(notify.bullets("Trade blocked", [
                ("Side", side.upper()), ("Market", market),
                ("Strategy", strategy), ("Reason", decision.reason),
            ]))
            return {"status": "rejected", "reason": decision.reason, "client_order_id": coid}

        min_q = self.client.min_quantity(market)
        if qty <= 0 or (min_q and qty < min_q):
            log.warning("qty %s below min %s for %s, skipping", qty, min_q, market)
            return {"status": "skipped", "reason": "below_min_qty", "client_order_id": coid}

        min_n = self.client.min_notional(market)
        if min_n and notional < min_n:
            # Skip WITHOUT touching position state (no fill happened, no desync).
            log.warning("notional %.2f below min %s for %s, skipping", notional, min_n, market)
            return {"status": "skipped", "reason": "below_min_notional", "client_order_id": coid}

        exchange_order_id = None
        response: dict = {}
        status = "dry_run"

        if config.LIVE:
            try:
                response = self.client.create_order(
                    market=market, side=side, qty=qty,
                    order_type="market_order", client_order_id=coid,
                )
                orders = response.get("orders") or [response]
                exchange_order_id = (orders[0] or {}).get("id")
                status = "placed"
                self.client.invalidate_balance_cache()  # wallet just changed - next read must be fresh
            except CoinDCXError as e:
                self._record({
                    "client_order_id": coid, "strategy": strategy, "market": market,
                    "side": side, "qty": qty, "price": price, "notional": notional,
                    "status": "error", "dry_run": False, "response": {"error": str(e)},
                }, reuse_row)
                log.error("ORDER FAILED %s %s %s: %s", strategy, market, side, e)
                notify.send(notify.bullets("Order failed", [
                    ("Side", side.upper()), ("Market", market),
                    ("Strategy", strategy), ("Error", str(e)),
                ]))
                return {"status": "error", "reason": str(e), "client_order_id": coid}

        # Fill realism. LIVE takes the real exchange price/qty; DRY_RUN simulates the spread
        # cost (adverse slippage) and, for oversized orders, a partial fill against a
        # liquidity cap - so paper P&L reflects what a market order really pays. No-op when
        # slippage_bps and max_fill_notional are 0. risk.check() already cleared the FULL
        # notional, so a partial fill only ever takes LESS exposure than was approved.
        if config.LIVE:
            # Prefer the exchange's own numbers when the create response carries them
            # (partial fills, real average price); fall back to the requested qty and
            # signal price when it doesn't. A partial live fill therefore books ONLY the
            # filled amount - position state and the exchange stay in agreement.
            fill_price, fill_qty = price, qty
            o = (response.get("orders") or [response])[0] or {}
            for k in ("filled_quantity", "executed_quantity", "total_quantity"):
                try:
                    v = float(o.get(k) or 0.0)
                except (TypeError, ValueError):
                    continue
                if 0 < v <= qty:
                    fill_qty = v
                    break
            for k in ("avg_price", "average_price", "price_per_unit"):
                try:
                    v = float(o.get(k) or 0.0)
                except (TypeError, ValueError):
                    continue
                if v > 0:
                    fill_price = v
                    break
        else:
            fill_price = costs.fill_price(side, price)
            fill_qty = self.client.round_qty(market, costs.fillable_qty(qty, price))
            if fill_qty <= 0:
                log.warning("simulated fill of 0 for %s (liquidity cap too small), skipping", market)
                return {"status": "skipped", "reason": "no_fill", "client_order_id": coid}
        fill_notional = fill_qty * fill_price
        partial = fill_qty < qty

        # simulate/record fill and update position
        new_qty, new_avg, realized = _apply_fill(old_qty, old_avg, side, fill_qty, fill_price)
        tds_paid = costs.tds(side, fill_notional)  # cash drag, tracked separately from P&L
        self._record({
            "client_order_id": coid, "strategy": strategy, "market": market,
            "side": side, "qty": fill_qty, "price": fill_price, "notional": fill_notional,
            "status": status, "dry_run": not config.LIVE,
            "exchange_order_id": exchange_order_id, "realized_pnl": realized,
            "tds": tds_paid, "response": response,
        }, reuse_row)
        # Carry chandelier/time-stop state: fresh on a new entry, preserved while adding, cleared on close.
        if old_qty == 0 and new_qty > 0:
            peak, entry_ts_val = price, candle_ts
        elif new_qty == 0:
            peak, entry_ts_val = 0.0, 0
        else:
            old_peak, old_entry = audit.get_meta(strategy, market)
            peak, entry_ts_val = max(old_peak, price), old_entry
        audit.set_position(strategy, market, new_qty, new_avg, peak, entry_ts_val)

        tag = "LIVE" if config.LIVE else "DRY_RUN"
        log.info("%s %s %s %s qty=%s @%s notional=%.2f pnl=%.2f%s",
                 tag, strategy, market, side, fill_qty, fill_price, fill_notional, realized,
                 f" PARTIAL(req {qty})" if partial else "")
        pnl_pct = (realized / fill_notional * 100) if fill_notional else 0.0
        ts_str = datetime.datetime.utcfromtimestamp(candle_ts / 1000).strftime("%Y-%m-%d %H:%M:%S UTC")
        notify.send(notify.bullets(f"{side.upper()} filled · {market}{'' if config.LIVE else ' (dry run)'}", [
            ("Quantity", f"{fill_qty}" + (f" (partial of {qty})" if partial else "")),
            ("Price", f"{fill_price}"),
            ("Notional", f"{fill_notional:.2f}"),
            ("Fee", f"{realized:.2f}") if increasing
            else ("P&L", f"{realized:+.2f} ({pnl_pct:+.2f}%)"),
            ("Strategy", strategy),
            ("Time", ts_str),
        ]))
        notify.email_trade(side=side, market=market, qty=fill_qty, price=fill_price,
                           notional=fill_notional, strategy=strategy, dry_run=not config.LIVE)
        return {"status": status, "client_order_id": coid, "realized_pnl": realized}

    def kill(self) -> None:
        """Kill switch action: cancel open orders (live) and halt. Idempotent to call.
        The kill path must ALWAYS win: any failure here (circuit breaker open, network
        down, clock-drift halt) is logged but never prevents the halt itself."""
        log.critical("KILL SWITCH engaged")
        notify.send("KILL SWITCH engaged - cancelling open orders, halting.")
        if config.LIVE:
            try:
                self.client.cancel_all()  # no market => cancel every open order
            except CoinDCXError as e:
                log.error("cancel_all failed: %s", e)
            except Exception as e:  # noqa: BLE001 - halting must not depend on the API
                log.error("cancel_all failed (%s); halting anyway", e)
