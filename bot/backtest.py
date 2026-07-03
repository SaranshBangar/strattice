"""Backtest harness. Replays historical candles through any strategy (long-only,
flat<->long, full allocation) and reports realistic India P&L.

Costs per the spec:
  FEE = 0.1% on BOTH buy and sell notional (CoinDCX trading fee)
  TDS = 1.0% on the SELL value (India VDA transfer tax, deducted on sale)
Change TDS_ON_BUY if you want TDS modeled on both legs.

Usage:
  python -m bot.backtest --module ma_crossover --market B-BTC_USDT \
         --interval 1h --limit 1000 --capital 1000 --params '{"fast":10,"slow":30}'
  python -m bot.backtest --selftest
"""
import argparse
import json
import math

from . import config, costs
from .client import Client
from .strategies import REGISTRY
from .strategies.base import atr

# Candle interval -> periods per year, for annualizing the Sharpe ratio.
_PERIODS_PER_YEAR = {
    "1m": 525600, "5m": 105120, "15m": 35040, "30m": 17520,
    "1h": 8760, "2h": 4380, "4h": 2190, "6h": 1460, "8h": 1095,
    "1d": 365, "1w": 52,
}


def run(strategy, candles: list[dict], capital: float,
        stop_loss_pct: float = 0.0, take_profit_pct: float = 0.0,
        slippage: float | None = None, interval: str = "1h",
        chandelier_k: float = 0.0, atr_period: int = 14, max_hold_bars: int = 0) -> dict:
    """All friction (fee+GST per side, TDS per sell, slippage on fills) comes from costs.py
    so the backtest, DRY_RUN, and live accounting can never diverge. slippage=None uses the
    configured slippage_bps; pass an explicit fraction to override.

    Exits (same precedence as the live engine): stop-loss, take-profit (target), time-stop
    (max_hold_bars), then an ATR chandelier trailing stop (peak - chandelier_k*ATR)."""
    slip = costs.slippage() if slippage is None else slippage
    cash, qty, entry_spend, entry_price = capital, 0.0, 0.0, 0.0
    entry_i, peak = -1, 0.0
    trades: list[float] = []          # realized P&L per round trip (NET of all costs)
    equity_curve: list[float] = []
    fees_paid = 0.0                   # total fee+GST AND TDS in quote currency
    total_tds = 0.0                   # TDS only (separate cash drag)
    sell_notional = 0.0               # gross sell consideration (TDS base)
    bars_in_market = 0

    def _sell(q: float, px: float) -> float:
        nonlocal fees_paid, total_tds, sell_notional
        gross = q * px * (1 - slip)        # sell slips down
        fee = costs.trading_fee(gross)
        t = costs.tds("sell", gross)
        fees_paid += fee + t
        total_tds += t
        sell_notional += gross
        return gross - fee - t

    start = max(strategy.min_candles, 2)
    for i in range(start, len(candles)):
        window = candles[: i + 1]
        price = candles[i]["close"]

        # 1) protective exit (close-based, same as the live engine) overrides the signal
        exited = False
        if qty > 0 and entry_price > 0:
            peak = max(peak, price)
            chandelier = (peak - chandelier_k * (atr(window, atr_period) or 0.0)) \
                if chandelier_k else 0.0
            hit = None
            if stop_loss_pct and price <= entry_price * (1 - stop_loss_pct):
                hit = "STOP_LOSS"
            elif take_profit_pct and price >= entry_price * (1 + take_profit_pct):
                hit = "TAKE_PROFIT"
            elif max_hold_bars and entry_i >= 0 and (i - entry_i) >= max_hold_bars:
                hit = "TIME_STOP"
            elif chandelier_k and chandelier and price <= chandelier:
                hit = "CHANDELIER"
            if hit:
                proceeds = _sell(qty, price)
                trades.append(proceeds - entry_spend)
                cash, qty, entry_price, entry_i, peak = proceeds, 0.0, 0.0, -1, 0.0
                exited = True

        action = strategy.decide(window)

        if not exited and action == "BUY" and qty == 0:
            fill = price * (1 + slip)         # buy slips up
            spend = cash
            fee = costs.trading_fee(spend)    # fee+GST on buy notional (no TDS on buys)
            fees_paid += fee
            qty = (spend - fee) / fill
            entry_spend, entry_price, cash = spend, fill, 0.0
            entry_i, peak = i, price
        elif not exited and action == "SELL" and qty > 0:
            proceeds = _sell(qty, price)
            trades.append(proceeds - entry_spend)
            cash, qty, entry_price = proceeds, 0.0, 0.0

        if qty > 0:
            bars_in_market += 1
        equity_curve.append(cash + qty * price)

    # mark-to-market any still-open position at the last price (costs applied as if sold)
    final_equity = _sell(qty, candles[-1]["close"]) if qty > 0 else cash

    # max drawdown
    peak = equity_curve[0] if equity_curve else capital
    max_dd = 0.0
    for e in equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak if peak else 0.0)

    # risk-adjusted + distribution metrics
    wins = [t for t in trades if t > 0]
    losses = [t for t in trades if t < 0]
    gross_win, gross_loss = sum(wins), abs(sum(losses))
    rets = [equity_curve[i] / equity_curve[i - 1] - 1 for i in range(1, len(equity_curve))
            if equity_curve[i - 1]]
    sharpe = 0.0
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(var)
        if sd > 0:
            sharpe = (mean / sd) * math.sqrt(_PERIODS_PER_YEAR.get(interval, 8760))

    n = len(trades)
    return {
        "capital": capital,
        "final_equity": round(final_equity, 2),
        "net_pnl": round(final_equity - capital, 2),
        "return_pct": round((final_equity - capital) / capital * 100, 2),
        "trades": n,
        "win_rate": round(len(wins) / n * 100, 1) if n else 0.0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else float("inf") if gross_win else 0.0,
        "expectancy": round(sum(trades) / n, 4) if n else 0.0,
        "avg_win": round(gross_win / len(wins), 4) if wins else 0.0,
        "avg_loss": round(-gross_loss / len(losses), 4) if losses else 0.0,
        "max_drawdown_pct": round(max_dd * 100, 2),
        "sharpe_annualized": round(sharpe, 2),
        "fees_tds_paid": round(fees_paid, 2),
        "total_tds": round(total_tds, 4),
        "sell_notional": round(sell_notional, 4),
        "fees_pct_of_capital": round(fees_paid / capital * 100, 2) if capital else 0.0,
        "exposure_pct": round(bars_in_market / max(len(equity_curve), 1) * 100, 1),
    }


def walk_forward(strategy, candles: list[dict], capital: float,
                 train: int, test: int, **run_kw) -> list[dict]:
    """Item 9: rolling walk-forward. Slide non-overlapping `test` windows forward; each fold
    is fed `train` preceding bars as out-of-sample indicator warmup/context, then evaluated.
    Strategies are non-parametric (no fit step), so 'train' is warmup context, not a fit.
    Reports net expectancy per test window. ponytail: plain loop, no param search."""
    n = len(candles)
    folds = []
    start = train
    while start + test <= n:
        seg = candles[start - train: start + test]
        res = run(strategy, seg, capital, **run_kw)
        folds.append({"test_start": start, "test_end": start + test,
                      "trades": res["trades"], "expectancy": res["expectancy"],
                      "net_pnl": res["net_pnl"], "total_tds": res["total_tds"]})
        start += test
    print(f"\nwalk-forward {strategy.name} train={train} test={test} -> {len(folds)} folds")
    for f in folds:
        print(f"  bars[{f['test_start']:>5}:{f['test_end']:<5}] "
              f"trades={f['trades']:>3} expectancy={f['expectancy']:>10} net={f['net_pnl']:>10} "
              f"tds={f['total_tds']}")
    if folds:
        avg_exp = sum(f["expectancy"] for f in folds) / len(folds)
        print(f"  mean net expectancy across folds: {round(avg_exp, 4)}")
    return folds


def _candles(closes: list[float], highs=None, lows=None, vols=None) -> list[dict]:
    """Deterministic synthetic candles from a close series (no network)."""
    return [{"open": c, "high": (highs[i] if highs else c), "low": (lows[i] if lows else c),
             "close": c, "volume": (vols[i] if vols else 1.0), "time": i * 3_600_000}
            for i, c in enumerate(closes)]


def _selftest_costs() -> None:
    """Item 1+2: friction routed through costs.py; TDS totals correctly."""
    from .strategies.base import Strategy

    # Hand-calc single round trip (no slippage) — fee+GST per side, TDS on sell.
    class _Stub(Strategy):
        min_candles = 2

        def decide(self, candles):
            c = candles[-1]["close"]
            return "BUY" if c <= 101 else "SELL" if c >= 109 else "HOLD"

    res = run(_Stub("s", "X", {}), _candles([100, 100, 100.5, 103, 106, 109, 110]),
              1000, slippage=0.0)
    qty = (1000 - costs.trading_fee(1000)) / 100.5
    gross = qty * 109
    proceeds = gross - costs.trading_fee(gross) - costs.tds("sell", gross)
    assert res["trades"] == 1, res
    assert res["net_pnl"] == round(proceeds - 1000, 2), (res["net_pnl"], proceeds - 1000)

    # (a) break-even-GROSS strategy (buy/sell at the same flat price) is net-NEGATIVE after costs.
    class _Flat(Strategy):
        min_candles = 2

        def decide(self, candles):
            return "BUY" if len(candles) % 2 == 0 else "SELL"

    flat = run(_Flat("s", "X", {}), _candles([100] * 12), 1000, slippage=0.0)
    assert flat["net_pnl"] < 0, ("break-even gross must lose after costs", flat)

    # (b) a real-edge strategy (big up-move) stays net-POSITIVE after costs.
    class _Edge(Strategy):
        min_candles = 2

        def decide(self, candles):
            c = candles[-1]["close"]
            return "BUY" if c <= 101 else "SELL" if c >= 120 else "HOLD"

    edge = run(_Edge("s", "X", {}), _candles([100, 100, 100.5, 105, 110, 115, 120, 121]),
               1000, slippage=0.0)
    assert edge["net_pnl"] > 0, ("known-edge strategy must stay net-positive", edge)

    # (c) total TDS == tds_rate * sum of sell notionals.
    tds_rate = costs.params()["tds_rate"]
    assert abs(edge["total_tds"] - tds_rate * edge["sell_notional"]) < 1e-3, edge
    print("backtest cost self-check OK:", {k: res[k] for k in
          ("trades", "net_pnl", "profit_factor", "expectancy", "total_tds")})


def _selftest_regime() -> None:
    """Item 3: regime gate works and CUTS trade count."""
    from .strategies.rsi import RSIMeanReversion

    rising = _candles([100 + i for i in range(60)])
    falling = _candles([200 - i for i in range(60)])
    gate = RSIMeanReversion("g", "X", {"regime_period": 50})
    assert gate._uptrend(rising), "regime gate should be True in an uptrend"
    assert not gate._uptrend(falling), "regime gate should be False in a downtrend"

    # Downtrend with a deep-oversold confirmation bounce: gated = no entry, ungated = entry.
    closes = [100 - i * 0.5 for i in range(40)]      # long decline -> RSI deeply oversold, below MA
    closes[-1] = closes[-2] + 1.0                    # one up bar: closes above prior high (confirm)
    candles = _candles(closes)
    params = {"period": 14, "oversold": 40, "regime_period": 20, "expected_move_pct": 0.05}
    strat = RSIMeanReversion("rsi", "X", params)

    def _buys(s):
        return sum(1 for i in range(s.min_candles, len(candles) + 1)
                   if s.decide(candles[:i]) == "BUY")

    gated = _buys(strat)
    strat._uptrend = lambda c: True  # bypass the gate to count what it suppressed
    ungated = _buys(strat)
    assert gated == 0 and ungated >= 1, ("regime gate must cut entries", gated, ungated)


def _selftest_exits() -> None:
    """Items 4/5: time-stop and ATR chandelier trailing stop force-close a long."""
    from .strategies.base import Strategy

    class _BuyOnce(Strategy):
        min_candles = 2

        def decide(self, candles):
            return "BUY"  # run() only buys when flat, so this opens once then holds

    # Chandelier: rise to a peak then fall back > k*ATR -> CHANDELIER exit (round trip closes).
    rise_fall = _candles([100, 100, 101, 105, 110, 115, 120, 110, 100, 95])
    r = run(_BuyOnce("s", "X", {}), rise_fall, 1000, slippage=0.0,
            chandelier_k=1.0, atr_period=3)
    assert r["trades"] == 1, ("chandelier should close the position", r)

    # Time-stop: flat prices, force-exit after max_hold_bars.
    r2 = run(_BuyOnce("s", "X", {}), _candles([100] * 12), 1000, slippage=0.0,
             max_hold_bars=3)
    assert r2["trades"] >= 1, ("time-stop should close the position", r2)


def _selftest_risk() -> None:
    """Item 8 + constraint C/A: fractional ceilings, no-dup-asset, no-leverage invariant."""
    from . import audit, sizing
    from .risk import RiskManager

    audit.init()
    eq_o, free_o, dup_o = sizing.equity, sizing.free_balance, audit.position_held_by_other
    try:
        sizing.equity = lambda *a, **k: 1000.0
        sizing.free_balance = lambda *a, **k: 1000.0
        audit.position_held_by_other = lambda s, m: False
        rm = RiskManager({"risk": {
            "max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
            "daily_loss_frac": 0.5, "max_trades_per_day": 20, "kill_switch_file": "KILL",
        }})
        assert rm.check(900, 900, strategy="a", market="X").ok
        assert not rm.check(1500, 1500, strategy="a", market="X").ok, "block notional > frac*eq"
        # no-leverage invariant: can't deploy more than free cash.
        sizing.free_balance = lambda *a, **k: 100.0
        d = rm.check(500, 500, strategy="a", market="X")
        assert not d.ok and "INSUFFICIENT_BALANCE" in d.reason, ("no-leverage invariant", d.reason)
        # no-dup-asset.
        sizing.free_balance = lambda *a, **k: 1000.0
        audit.position_held_by_other = lambda s, m: True
        d = rm.check(100, 100, strategy="a", market="X")
        assert not d.ok and d.reason == "DUP_ASSET", ("dup asset", d.reason)
    finally:
        sizing.equity, sizing.free_balance = eq_o, free_o
        audit.position_held_by_other = dup_o


def _selftest_sizing() -> None:
    """Constraint B: positions scale with equity; notional never exceeds free balance."""
    from . import sizing

    class _FakeClient:
        def markets(self):
            return {"X": {"target_currency_precision": 6}}

        def min_notional(self, m):
            return 1.0

    fc = _FakeClient()
    eq_o, free_o = sizing.equity, sizing.free_balance
    try:
        def size_at(wallet):
            sizing.equity = lambda *a, **k: float(wallet)
            sizing.free_balance = lambda *a, **k: float(wallet)
            q = sizing.target_qty("X", 100.0, fc)
            return q, q * 100.0

        q1, n1 = size_at(1000)
        q5, n5 = size_at(5000)
        assert n1 <= 1000 + 1e-9, ("exposure must not exceed free balance", n1)
        assert n5 <= 5000 + 1e-9, ("exposure must not exceed free balance", n5)
        assert abs(n5 / n1 - 5.0) < 0.01, ("sizing must scale with equity", n1, n5)
        # below-min-notional -> 0
        sizing.equity = lambda *a, **k: 0.5
        sizing.free_balance = lambda *a, **k: 0.5
        assert sizing.target_qty("X", 100.0, fc) == 0.0, "too-small wallet must skip"
    finally:
        sizing.equity, sizing.free_balance = eq_o, free_o


def _selftest_sleeves() -> None:
    """Phase 2 money path: sleeves sum <= allocation cap; across a sequence of concurrent fills the
    total deployed never exceeds free balance (no leverage); a sub-min-notional sleeve is flagged,
    not traded."""
    from . import sizing

    cfg = {
        "allocation_frac": 0.97,
        "strategies": [
            {"name": "a", "enabled": True, "weight": 1.0},
            {"name": "b", "enabled": True, "weight": 1.0},
            {"name": "c", "enabled": True, "weight": 2.0},   # double weight -> double sleeve
            {"name": "off", "enabled": False, "weight": 5.0},  # disabled -> excluded
        ],
    }
    sl = sizing.sleeve_fracs(cfg)
    # (a) sum of sleeve fractions <= allocation cap, disabled excluded, weights honored.
    assert "off" not in sl, sl
    assert sum(sl.values()) <= 0.97 + 1e-9, ("sleeves must not exceed allocation cap", sl)
    assert abs(sum(sl.values()) - 0.97) < 1e-9, ("normalized sleeves sum to the cap", sl)
    assert abs(sl["c"] - 2 * sl["a"]) < 1e-9, ("weight must scale the sleeve", sl)

    # (b) simulate concurrent fills: total deployed never exceeds free balance (no leverage).
    equity = 1000.0
    free = equity
    deployed = 0.0
    for n, frac in sl.items():
        notional = min(frac * equity, free)   # same cap sizing applies (fee headroom omitted = worst case)
        assert deployed + notional <= equity + 1e-9, ("LEVERAGE BREACH", n, deployed, notional)
        deployed += notional
        free -= notional
    assert deployed <= equity + 1e-9, ("total deployed must not exceed equity", deployed)

    # (c) a sleeve below the pair's min-notional is flagged (warning path), not an order.
    assert sizing.sleeve_too_small(0.05, 1000.0, 100.0), "0.05*1000=50 < 100 must flag"
    assert not sizing.sleeve_too_small(0.485, 1000.0, 100.0), "0.485*1000=485 >= 100 must NOT flag"
    print("sleeve sizing self-check OK:", {k: round(v, 4) for k, v in sl.items()},
          "deployed=", round(deployed, 2))


def _selftest_static_invariants() -> None:
    """Constraint A: the bot never moves funds, never uses leverage/margin/futures."""
    import pathlib
    import re

    botdir = pathlib.Path(__file__).resolve().parent
    money_move = re.compile(r"\.(deposit|withdraw|withdrawal|transfer)\s*\(|"
                            r"/(transfer|withdraw|deposit)[a-z_]*|leverage\s*=|"
                            r"create_(margin|futures|leverage)")
    bad_order = re.compile(r'order_type\s*=\s*["\'](?!market_order)')
    for f in botdir.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        # strip comments so prose like "no-leverage" can't trip the scan
        code = "\n".join(line.split("#", 1)[0] for line in src.splitlines())
        assert not money_move.search(code), f"fund-movement / leverage call in {f.name}"
        assert not bad_order.search(code), f"non-market order_type in {f.name}"

    # config markets are CoinDCX SPOT pairs, never futures/margin identifiers. Spot ecodes are
    # B- (USDT-quoted) and I- (INR-quoted); the no-leverage scan above is the real futures guard.
    cfg = config.load()
    spot = re.compile(r"^[BI]-[A-Z0-9]+_[A-Z0-9]+$")
    for s in cfg["strategies"]:
        assert spot.match(s["market"]), f"non-spot market in config: {s['market']}"


def demo() -> None:
    costs.demo()
    _selftest_costs()
    _selftest_regime()
    _selftest_exits()
    _selftest_risk()
    _selftest_sizing()
    _selftest_sleeves()
    _selftest_static_invariants()
    print("ALL backtest self-checks OK")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--module", choices=list(REGISTRY))
    p.add_argument("--market", default="B-BTC_USDT")
    p.add_argument("--interval", default="1h")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--capital", type=float, default=1000.0)
    p.add_argument("--params", default="{}", help="JSON strategy params")
    p.add_argument("--stop-loss", type=float, default=0.0, help="stop-loss fraction, e.g. 0.04 = 4%")
    p.add_argument("--take-profit", type=float, default=0.0, help="take-profit fraction, e.g. 0.06 = 6%")
    p.add_argument("--slippage", type=float, default=None,
                   help="per-fill slippage fraction (default: config costs.slippage_bps)")
    p.add_argument("--chandelier-k", type=float, default=0.0, help="ATR multiple for chandelier trailing stop")
    p.add_argument("--atr-period", type=int, default=14, help="ATR lookback for the chandelier stop")
    p.add_argument("--max-hold-bars", type=int, default=0, help="time-stop: force-exit after N bars (0=off)")
    p.add_argument("--walkforward", action="store_true", help="rolling train/test walk-forward report")
    p.add_argument("--train", type=int, default=400, help="walk-forward train window (bars)")
    p.add_argument("--test", type=int, default=100, help="walk-forward test window (bars)")
    p.add_argument("--data", default="", help="offline candles CSV(.gz) with time,open,high,low,close,volume "
                                             "(e.g. research/data/*.csv.gz) instead of the live API")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()

    if a.selftest or not a.module:
        demo()
        return

    if a.data:
        import csv as _csv
        import gzip as _gzip
        op = _gzip.open if a.data.endswith(".gz") else open
        with op(a.data, "rt", newline="") as f:
            candles = [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
                        "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["volume"])}
                       for r in _csv.DictReader(f)]
    else:
        candles = Client().candles(a.market, a.interval, a.limit)
    strat = REGISTRY[a.module]("backtest", a.market, json.loads(a.params))
    kw = dict(stop_loss_pct=a.stop_loss, take_profit_pct=a.take_profit, slippage=a.slippage,
              interval=a.interval, chandelier_k=a.chandelier_k, atr_period=a.atr_period,
              max_hold_bars=a.max_hold_bars)
    if a.walkforward:
        walk_forward(strat, candles, a.capital, a.train, a.test, **kw)
        return
    res = run(strat, candles, a.capital, **kw)
    print(f"\n{a.module} on {a.market} {a.interval} ({len(candles)} candles) "
          f"sl={a.stop_loss} tp={a.take_profit} slip={a.slippage}")
    for k, v in res.items():
        print(f"  {k:20} {v}")


if __name__ == "__main__":
    main()
