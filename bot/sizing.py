"""Wallet-scaled position sizing (constraint B) — replaces fixed-$ sizing.

Positions scale with equity so a $1k and a $5k wallet both deploy near-full, proportionally.
The no-leverage invariant (total deployed <= free balance) is enforced in risk.py; here we
size a single entry to fit the wallet with fee headroom and the pair's min-notional floor.

Two sources of truth for money:
  LIVE     -> real free USDT from the exchange.
  DRY_RUN  -> simulated = starting_equity (config) + all realized P&L (audit);
              free = that minus the cost basis of open positions. NEVER reads live balance.
"""
import math

from . import audit, config, costs
from .client import Client

_cfg_cache: dict | None = None
_client: Client | None = None


def _cfg() -> dict:
    global _cfg_cache
    if _cfg_cache is None:
        _cfg_cache = config.load()
    return _cfg_cache


def _live_client(client: Client | None) -> Client:
    global _client
    if client is not None:
        return client
    if _client is None:
        _client = Client()
    return _client


def allocation_frac() -> float:
    return float(_cfg().get("allocation_frac", 0.97))


def equity(client: Client | None = None) -> float:
    """Total net worth in quote (USDT). Open positions marked at cost (avg)."""
    if config.LIVE:
        c = _live_client(client)
        return c.free_balance("USDT") + audit.today_stats()["capital_at_risk"]
    return float(_cfg().get("starting_equity", 1000.0)) + audit.total_realized()


def free_balance(client: Client | None = None) -> float:
    """Uninvested cash available to deploy (quote/USDT)."""
    if config.LIVE:
        return _live_client(client).free_balance("USDT")
    return equity() - audit.today_stats()["capital_at_risk"]


def _floor_qty(client: Client, market: str, qty: float) -> float:
    """Round DOWN to the pair's step/precision so notional never exceeds balance."""
    m = client.markets().get(market)
    prec = int(m.get("target_currency_precision", 8)) if m else 8
    f = 10 ** prec
    return math.floor(qty * f) / f


def target_qty(market: str, price: float, client: Client | None = None) -> float:
    """Quantity to BUY: allocation_frac of equity, capped by fee-adjusted free balance,
    floored to precision, and zeroed if below the pair's min-notional."""
    if price <= 0:
        return 0.0
    c = _live_client(client)
    p = costs.params()
    headroom = free_balance(c) / (1 + p["fee_rate"] * (1 + p["gst_on_fee"]))
    target_notional = min(allocation_frac() * equity(c), headroom)
    if target_notional <= 0:
        return 0.0
    qty = _floor_qty(c, market, target_notional / price)
    notional = qty * price
    if notional <= 0:
        return 0.0
    min_n = c.min_notional(market)
    if min_n and notional < min_n:
        return 0.0  # too small to trade
    return qty
