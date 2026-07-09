"""Single source of truth for all trading friction (fees, GST, TDS, slippage).

CoinDCX charges the SAME 0.2% on maker and taker, plus 18% GST on that fee.
India also withholds 1% TDS on the SELL consideration (a cash drag, NOT P&L).
Every fee/TDS/edge calculation in the bot and backtest routes through here so
DRY_RUN accounting, live accounting, and the backtest can never disagree.

Tunables come from config.yaml's `costs:` block; defaults below are the live
CoinDCX/India reality and are used if a key is missing.
"""
from . import config

_DEFAULTS = {
    "fee_rate": 0.002,        # 0.2% per side (maker == taker on CoinDCX)
    "gst_on_fee": 0.18,       # 18% GST levied on the fee itself
    "tds_rate": 0.01,         # 1% TDS on SELL consideration (India VDA)
    "slippage_bps": 0.0,      # adverse market-order slippage, modelled in BACKTEST + DRY_RUN fills
    "max_fill_notional": 0.0, # DRY_RUN partial-fill liquidity cap per order; 0 = unlimited (full fill)
    "edge_margin_pct": 0.002, # extra move a signal must clear beyond round-trip fee+gst
}

_cache: dict | None = None


def params() -> dict:
    """Cached costs config (file read once). Defaults fill any missing key."""
    global _cache
    if _cache is None:
        try:
            c = config.load().get("costs", {}) or {}
        except Exception:  # noqa: BLE001 - never let config IO break a fee calc
            c = {}
        _cache = {**_DEFAULTS, **c}
    return _cache


def trading_fee(notional: float) -> float:
    """Exchange fee + GST on one side of a trade, in quote currency."""
    p = params()
    return p["fee_rate"] * notional * (1 + p["gst_on_fee"])


def tds(side: str, notional: float) -> float:
    """1% TDS withheld on SELL consideration only. Zero on buys."""
    return params()["tds_rate"] * notional if side == "sell" else 0.0


def round_trip_cost_pct() -> float:
    """Fee+GST on entry AND exit, as a fraction of notional (TDS excluded — see clears_costs)."""
    p = params()
    return 2 * p["fee_rate"] * (1 + p["gst_on_fee"])


def slippage() -> float:
    """Per-fill adverse slippage as a fraction (from slippage_bps)."""
    return params()["slippage_bps"] / 10_000.0


def fill_price(side: str, price: float) -> float:
    """Market-order fill price after adverse slippage: a BUY lifts the ask (pays up), a
    SELL hits the bid (receives less). Used for DRY_RUN fills so paper P&L reflects the
    spread cost a real market order pays. No-op when slippage_bps == 0."""
    slip = slippage()
    if slip <= 0 or price <= 0:
        return price
    return price * (1 + slip) if side == "buy" else price * (1 - slip)


def fillable_qty(qty: float, price: float) -> float:
    """Quantity that fills against simulated top-of-book liquidity. A market order larger
    than max_fill_notional fills only up to that cap (a partial fill); the rest is dropped
    for this candle. 0 cap (default) = unlimited, i.e. always a full fill."""
    cap = float(params().get("max_fill_notional", 0.0) or 0.0)
    if cap <= 0 or price <= 0 or qty <= 0:
        return qty
    return min(qty, cap / price)


def clears_costs(expected_move_pct: float) -> bool:
    """True only if the expected move beats round-trip fee+gst plus a configurable margin."""
    return expected_move_pct > round_trip_cost_pct() + params()["edge_margin_pct"]


def demo() -> None:
    # ponytail: one runnable check for the money path.
    p = params()
    assert abs(trading_fee(100) - 100 * p["fee_rate"] * (1 + p["gst_on_fee"])) < 1e-12
    assert tds("sell", 100) == p["tds_rate"] * 100
    assert tds("buy", 100) == 0.0
    assert clears_costs(0.10) is True
    assert clears_costs(0.0) is False
    # fill model: slippage is adverse (buy up, sell down); fillable caps at max_fill_notional.
    slip = slippage()
    assert abs(fill_price("buy", 100) - 100 * (1 + slip)) < 1e-12
    assert abs(fill_price("sell", 100) - 100 * (1 - slip)) < 1e-12
    assert fillable_qty(5, 100) == 5  # unlimited by default
    print("costs self-check OK:", p)


if __name__ == "__main__":
    demo()
