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
    "slippage_bps": 0.0,      # modelled in BACKTEST only (live is fire-and-forget at price)
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
    """Per-fill slippage as a fraction (backtest only)."""
    return params()["slippage_bps"] / 10_000.0


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
    print("costs self-check OK:", p)


if __name__ == "__main__":
    demo()
