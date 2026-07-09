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
import time

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


# `window = candles[:i+1]` used to hand every strategy the FULL history-so-far, growing by one
# element each bar - an O(n) list copy repeated n times is O(n^2) over a long CSV backtest. No
# built-in strategy's decide() looks back further than a small, bounded number of bars (its own
# `min_candles`, derived from its lookback/period/regime_period params); this pads that bound
# generously so the window is a fixed-size trailing slice instead of an ever-growing one, without
# changing what any strategy can see. Verified bar-for-bar identical to the old unbounded-window
# behavior for every registered strategy - see bot/test_decision_window.py.
_WINDOW_PAD = 300
_WINDOW_FLOOR = 200


def _decision_window_bars(strategy) -> int:
    extra = int(getattr(strategy, "context", 0))  # hf_forecast's model context can exceed min_candles
    return max(strategy.min_candles + _WINDOW_PAD, extra + _WINDOW_PAD, _WINDOW_FLOOR)


def run(strategy, candles: list[dict], capital: float,
        stop_loss_pct: float = 0.0, take_profit_pct: float = 0.0,
        slippage: float | None = None, interval: str = "1h",
        chandelier_k: float = 0.0, atr_period: int = 14, max_hold_bars: int = 0,
        trade_from: int = 0) -> dict:
    """All friction (fee+GST per side, TDS per sell, slippage on fills) comes from costs.py
    so the backtest, DRY_RUN, and live accounting can never diverge. slippage=None uses the
    configured slippage_bps; pass an explicit fraction to override.

    trade_from: first bar index allowed to trade/score. Earlier bars still feed indicator
    windows (via the decision-window slice), but no orders are placed and no metrics count
    before it - so walk_forward can warm up on train bars yet measure ONLY the test window.

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

    # Warmup bars before trade_from still populate the decision-window slice, but the loop
    # (and therefore every trade and every metric) begins at trade_from - the position starts
    # flat, so a fold measures only its out-of-sample test window.
    start = max(strategy.min_candles, 2, trade_from)
    window_bars = _decision_window_bars(strategy)
    for i in range(start, len(candles)):
        window = candles[max(0, i + 1 - window_bars): i + 1]
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
                 train: int, test: int, **run_kw) -> dict:
    """Rolling out-of-sample walk-forward. Slide non-overlapping `test` windows forward; each
    fold warms indicators on the preceding `train` bars but TRADES AND SCORES ONLY the test
    window (run(trade_from=train)), so every fold is genuinely out-of-sample and starts flat.

    Reports per-fold metrics, a stitched OOS summary (compounded return, hit rate, worst/best,
    cross-fold consistency), and an in-sample-vs-out-of-sample return gap as an overfitting
    signal. Strategies here are non-parametric, so that gap flags REGIME FRAGILITY (an edge
    that only shows up when the model sees the whole span at once) rather than classic
    parameter overfit. ponytail: plain rolling loop, no param search."""
    n = len(candles)
    folds: list[dict] = []
    start = train
    while start + test <= n:
        seg = candles[start - train: start + test]
        res = run(strategy, seg, capital, trade_from=train, **run_kw)
        res["test_start"], res["test_end"] = start, start + test
        folds.append(res)
        start += test

    print(f"\nwalk-forward {strategy.name} train={train} test={test} -> {len(folds)} OOS folds")
    for f in folds:
        print(f"  bars[{f['test_start']:>6}:{f['test_end']:<6}] trades={f['trades']:>3} "
              f"ret={f['return_pct']:>7}% win={f['win_rate']:>5}% PF={f['profit_factor']:>5} "
              f"maxDD={f['max_drawdown_pct']:>6}% net={f['net_pnl']:>10}")

    if not folds:
        print("  (no complete folds - need more history, or a smaller --test/--train)")
        return {"folds": [], "summary": {}}

    k = len(folds)
    rets = [f["return_pct"] for f in folds]
    profitable = sum(1 for r in rets if r > 0)
    compounded = 1.0                      # stitched OOS equity: fold returns compounded in sequence
    for r in rets:
        compounded *= 1 + r / 100
    oos_return = (compounded - 1) * 100
    mean_ret = sum(rets) / k
    if k > 1:
        sd = math.sqrt(sum((r - mean_ret) ** 2 for r in rets) / (k - 1))
        consistency = round(mean_ret / sd, 2) if sd else float("inf")
    else:
        consistency = 0.0

    # In-sample baseline: one full-history run (holds across boundaries, sees everything at
    # once). The gap to the disciplined stitched-OOS return is the overfitting/fragility flag.
    is_res = run(strategy, candles, capital, **run_kw)

    summary = {
        "oos_folds": k,
        "oos_folds_profitable": profitable,
        "oos_hit_rate_pct": round(profitable / k * 100, 1),
        "oos_return_compounded_pct": round(oos_return, 2),
        "oos_mean_fold_return_pct": round(mean_ret, 2),
        "oos_median_fold_return_pct": round(sorted(rets)[k // 2], 2),
        "oos_worst_fold_pct": round(min(rets), 2),
        "oos_best_fold_pct": round(max(rets), 2),
        "oos_consistency": consistency,
        "oos_mean_expectancy": round(sum(f["expectancy"] for f in folds) / k, 4),
        "oos_mean_sharpe": round(sum(f["sharpe_annualized"] for f in folds) / k, 2),
        "insample_return_pct": is_res["return_pct"],
        "insample_sharpe": is_res["sharpe_annualized"],
        "is_minus_oos_return_pct": round(is_res["return_pct"] - oos_return, 2),
    }

    print(f"\n  OOS summary: {profitable}/{k} folds profitable ({summary['oos_hit_rate_pct']}%)")
    print(f"    compounded OOS return : {summary['oos_return_compounded_pct']}%")
    print(f"    mean / median fold    : {summary['oos_mean_fold_return_pct']}% / {summary['oos_median_fold_return_pct']}%")
    print(f"    worst / best fold     : {summary['oos_worst_fold_pct']}% / {summary['oos_best_fold_pct']}%")
    print(f"    consistency (mean/sd) : {summary['oos_consistency']}")
    print(f"    mean expectancy/Sharpe: {summary['oos_mean_expectancy']} / {summary['oos_mean_sharpe']}")
    print(f"  overfitting check - in-sample {summary['insample_return_pct']}% vs OOS "
          f"{summary['oos_return_compounded_pct']}% (gap {summary['is_minus_oos_return_pct']} pts; "
          f"large positive gap = edge is fragile out-of-sample)")
    return {"folds": folds, "summary": summary}


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


def _selftest_walkforward() -> None:
    """trade_from gates trading to the test window, so a round trip in the warmup region is
    excluded once the fold skips past it - the core out-of-sample guarantee."""
    from .strategies.base import Strategy

    class _Stub(Strategy):
        min_candles = 2

        def decide(self, candles):
            c = candles[-1]["close"]
            return "BUY" if c <= 101 else "SELL" if c >= 109 else "HOLD"

    # Warmup bars carry a full buy(100.5)->sell(109) round trip; the test region is flat.
    cs = _candles([100, 100, 100.5, 108, 109, 105, 105, 105])
    full = run(_Stub("s", "X", {}), cs, 1000, slippage=0.0)
    oos = run(_Stub("s", "X", {}), cs, 1000, slippage=0.0, trade_from=5)
    assert full["trades"] == 1, ("warmup round trip should count with trade_from=0", full["trades"])
    assert oos["trades"] == 0, ("trade_from must exclude the warmup round trip", oos["trades"])
    assert oos["return_pct"] == 0.0, oos["return_pct"]

    # walk_forward now returns a summary dict with the OOS/overfitting fields populated.
    wf = walk_forward(_Stub("s", "X", {}), _candles([100 + (i % 7) for i in range(60)]),
                      1000, train=10, test=10, slippage=0.0)
    assert set(wf) == {"folds", "summary"} and wf["summary"]["oos_folds"] >= 1, wf
    assert "is_minus_oos_return_pct" in wf["summary"]


def demo() -> None:
    costs.demo()
    _selftest_costs()
    _selftest_regime()
    _selftest_exits()
    _selftest_risk()
    _selftest_sizing()
    _selftest_sleeves()
    _selftest_static_invariants()
    _selftest_walkforward()
    print("ALL backtest self-checks OK")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--module", choices=list(REGISTRY))
    p.add_argument("--market", default="B-BTC_USDT")
    p.add_argument("--interval", default="1h")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--years", type=float, default=0.0,
                   help="fetch N years of history, paginated past the ~1000-bar API cap; overrides --limit")
    p.add_argument("--capital", type=float, default=1000.0)
    p.add_argument("--params", default="{}", help="JSON strategy params")
    p.add_argument("--stop-loss", type=float, default=0.0, help="stop-loss fraction, e.g. 0.04 = 4%%")
    p.add_argument("--take-profit", type=float, default=0.0, help="take-profit fraction, e.g. 0.06 = 6%%")
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
    elif a.years and a.years > 0:
        since = int((time.time() - a.years * 365.25 * 86400) * 1000)
        candles = Client().candles(a.market, a.interval, since_ms=since)
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
