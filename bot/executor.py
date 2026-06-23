"""Single risk-managed order path. EVERY order in the system goes through place().

Guarantees:
- DRY_RUN by default: logs intent, places nothing, but still simulates fills so
  risk accounting and /status stay realistic.
- Idempotent: client_order_id = deterministic hash of (strategy, market, candle_ts, side).
  The same logical decision on the same candle can never be submitted twice, even after
  a crash/restart (DB UNIQUE constraint is the backstop).
- Risk-gated: RiskManager.check() runs before any live or simulated fill.
"""
import hashlib
import logging

from . import audit, config, notify
from .client import Client, CoinDCXError
from .risk import RiskManager

log = logging.getLogger("executor")

FEE_RATE = 0.001  # 0.1% CoinDCX trading fee (TDS modeled in backtest; see backtest.py)


def _coid(strategy: str, market: str, candle_ts: int, side: str) -> str:
    raw = f"{strategy}:{market}:{candle_ts}:{side}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _apply_fill(old_qty: float, old_avg: float, side: str, qty: float, price: float):
    """Return (new_qty, new_avg, realized_pnl_net_of_fee) for a fill. Signed qty: +long/-short."""
    signed = qty if side == "buy" else -qty
    fee = qty * price * FEE_RATE

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

    def place(self, *, strategy: str, market: str, side: str, qty: float,
              price: float, candle_ts: int) -> dict:
        coid = _coid(strategy, market, candle_ts, side)
        if audit.order_exists(coid):
            log.info("idempotent skip %s %s %s (coid=%s)", strategy, market, side, coid)
            return {"status": "skipped", "client_order_id": coid}

        qty = self.client.round_qty(market, qty)
        notional = qty * price
        old_qty, old_avg = audit.get_position(strategy, market)
        signed = qty if side == "buy" else -qty
        increasing = old_qty == 0 or (old_qty > 0) == (signed > 0)
        new_exposure = notional if increasing else 0.0

        decision = self.risk.check(notional, new_exposure)
        if not decision.ok:
            audit.log_order({
                "client_order_id": coid, "strategy": strategy, "market": market,
                "side": side, "qty": qty, "price": price, "notional": notional,
                "status": "rejected", "dry_run": not config.LIVE,
                "response": {"reason": decision.reason},
            })
            log.warning("RISK BLOCK %s %s %s: %s", strategy, market, side, decision.reason)
            notify.send(f"⛔ Trade blocked [{strategy} {market} {side}]: {decision.reason}")
            return {"status": "rejected", "reason": decision.reason, "client_order_id": coid}

        min_q = self.client.min_quantity(market)
        if qty <= 0 or (min_q and qty < min_q):
            log.warning("qty %s below min %s for %s, skipping", qty, min_q, market)
            return {"status": "skipped", "reason": "below_min_qty", "client_order_id": coid}

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
            except CoinDCXError as e:
                audit.log_order({
                    "client_order_id": coid, "strategy": strategy, "market": market,
                    "side": side, "qty": qty, "price": price, "notional": notional,
                    "status": "error", "dry_run": False, "response": {"error": str(e)},
                })
                log.error("ORDER FAILED %s %s %s: %s", strategy, market, side, e)
                notify.send(f"🚨 Order FAILED [{strategy} {market} {side}]: {e}")
                return {"status": "error", "reason": str(e), "client_order_id": coid}

        # simulate/record fill at `price` (market order assumption) and update position
        new_qty, new_avg, realized = _apply_fill(old_qty, old_avg, side, qty, price)
        audit.log_order({
            "client_order_id": coid, "strategy": strategy, "market": market,
            "side": side, "qty": qty, "price": price, "notional": notional,
            "status": status, "dry_run": not config.LIVE,
            "exchange_order_id": exchange_order_id, "realized_pnl": realized,
            "response": response,
        })
        audit.set_position(strategy, market, new_qty, new_avg)

        tag = "LIVE" if config.LIVE else "DRY_RUN"
        log.info("%s %s %s %s qty=%s @%s notional=%.2f pnl=%.2f",
                 tag, strategy, market, side, qty, price, notional, realized)
        notify.send(f"✅ {tag} {side.upper()} {qty} {market} @ {price} "
                    f"[{strategy}] notional={notional:.2f}")
        return {"status": status, "client_order_id": coid, "realized_pnl": realized}

    def kill(self) -> None:
        """Kill switch action: cancel open orders (live) and halt. Idempotent to call."""
        log.critical("KILL SWITCH engaged")
        notify.send("🛑 KILL SWITCH engaged — cancelling open orders, halting.")
        if config.LIVE:
            for pos in audit.open_positions():
                try:
                    self.client.cancel_all(pos["market"])
                except CoinDCXError as e:
                    log.error("cancel_all failed for %s: %s", pos["market"], e)
