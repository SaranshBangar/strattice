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

from .client import Client
from .strategies import REGISTRY

FEE = 0.001   # 0.1%
TDS = 0.01    # 1%
TDS_ON_BUY = False

# Candle interval -> periods per year, for annualizing the Sharpe ratio.
_PERIODS_PER_YEAR = {
    "1m": 525600, "5m": 105120, "15m": 35040, "30m": 17520,
    "1h": 8760, "2h": 4380, "4h": 2190, "6h": 1460, "8h": 1095,
    "1d": 365, "1w": 52,
}


def run(strategy, candles: list[dict], capital: float,
        stop_loss_pct: float = 0.0, take_profit_pct: float = 0.0,
        slippage: float = 0.0, interval: str = "1h") -> dict:
    cash, qty, entry_spend, entry_price = capital, 0.0, 0.0, 0.0
    trades: list[float] = []          # realized P&L per round trip
    equity_curve: list[float] = []
    fees_paid = 0.0                   # total fee + TDS in quote currency
    bars_in_market = 0

    def _sell(q: float, px: float) -> float:
        nonlocal fees_paid
        gross = q * px * (1 - slippage)   # sell slips down
        cost = gross * (FEE + TDS)
        fees_paid += cost
        return gross - cost

    start = max(strategy.min_candles, 2)
    for i in range(start, len(candles)):
        window = candles[: i + 1]
        price = candles[i]["close"]

        # 1) protective exit (close-based, same as the live engine) overrides the signal
        exited = False
        if qty > 0 and entry_price > 0:
            hit = None
            if stop_loss_pct and price <= entry_price * (1 - stop_loss_pct):
                hit = True
            elif take_profit_pct and price >= entry_price * (1 + take_profit_pct):
                hit = True
            if hit:
                proceeds = _sell(qty, price)
                trades.append(proceeds - entry_spend)
                cash, qty, entry_price = proceeds, 0.0, 0.0
                exited = True

        action = strategy.decide(window)

        if not exited and action == "BUY" and qty == 0:
            buy_tds = TDS if TDS_ON_BUY else 0.0
            fill = price * (1 + slippage)         # buy slips up
            spend = cash
            cost = spend * (FEE + buy_tds)
            fees_paid += cost
            qty = (spend - cost) / fill
            entry_spend, entry_price, cash = spend, fill, 0.0
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
        "fees_pct_of_capital": round(fees_paid / capital * 100, 2) if capital else 0.0,
        "exposure_pct": round(bars_in_market / max(len(equity_curve), 1) * 100, 1),
    }


def _build(module: str, market: str, capital: float, params: dict):
    return REGISTRY[module]("backtest", market, capital, params)


def demo() -> None:
    # Forced single round trip on a 100->110 rise; assert P&L matches hand calc incl fee+TDS.
    from .strategies.base import Strategy

    class _Stub(Strategy):
        min_candles = 2

        def decide(self, candles):
            c = candles[-1]["close"]
            if c <= 101:
                return "BUY"
            if c >= 109:
                return "SELL"
            return "HOLD"

    # run() skips warmup bars (starts at index = min_candles=2), so put the BUY trigger at index 2.
    closes = [100, 100, 100.5, 103, 106, 109, 110]
    candles = [{"open": c, "high": c, "low": c, "close": c, "volume": 1, "time": i}
               for i, c in enumerate(closes)]
    res = run(_Stub("s", "X", 1000, {}), candles, 1000)

    qty = 1000 * (1 - FEE) / 100.5          # buy at index 2 (100.5)
    proceeds = qty * 109 * (1 - FEE - TDS)  # first SELL trigger is at 109
    expect = round(proceeds - 1000, 2)
    assert res["trades"] == 1, res
    assert res["net_pnl"] == expect, (res["net_pnl"], expect)
    assert res["win_rate"] == 100.0, res
    print("backtest self-check OK:", res)


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
    p.add_argument("--slippage", type=float, default=0.0, help="per-fill slippage fraction, e.g. 0.001 = 0.1%")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()

    if a.selftest or not a.module:
        demo()
        return

    candles = Client().candles(a.market, a.interval, a.limit)
    strat = _build(a.module, a.market, a.capital, json.loads(a.params))
    res = run(strat, candles, a.capital, stop_loss_pct=a.stop_loss,
              take_profit_pct=a.take_profit, slippage=a.slippage, interval=a.interval)
    print(f"\n{a.module} on {a.market} {a.interval} ({len(candles)} candles) "
          f"sl={a.stop_loss} tp={a.take_profit} slip={a.slippage}")
    for k, v in res.items():
        print(f"  {k:20} {v}")


if __name__ == "__main__":
    main()
