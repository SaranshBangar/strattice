"""Portfolio-level study: joint simulation of the v6 seven-sleeve lineup.

bot/backtest.py replays ONE sleeve against ONE market. This harness replays all seven
sleeves TOGETHER over the aligned INR daily history - same strategies, same cost model
(bot/costs.py), same close-based exit precedence - so portfolio-shaped questions can be
answered with evidence instead of vibes:

  --study entries    per-day new-entry cap + same-day correlation-scaled sizing
  --study vol        volatility-targeted per-sleeve entry sizing
  --study btc        BTC 100d trend overlay scaling ALL sleeve entries
  --study cooldown   re-entry cooldown bars after a stop-out
  --study brake      intraday crash brake (hard stop on bar LOWS, gap-aware) vs
                     close-only stops - the honest cost/benefit of acting intraday
  --study consec     halt new entries after N consecutive portfolio losses
  --study weights    conservative / balanced / aggressive sleeve weight presets
  --study all        everything (default)

Each study prints full-history portfolio metrics (net %, max DD on daily marks, trades,
fees) plus 200-bar walk-forward folds (portfolio restarted flat per fold), baseline
always in row one. Promotion bar = the v6 protocol: an option must beat baseline
walk-forward, not just full-history.

Run:  python -m research.portfolio_study [--study X] [--capital 7000]
"""
from __future__ import annotations

import argparse
import csv
import gzip
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot import costs                    # noqa: E402
from bot.strategies import REGISTRY      # noqa: E402
from bot.strategies.base import atr      # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
WINDOW = 400  # bars handed to decide(), mirroring the live engine's candle_limit

# The v6 lineup, verbatim from config.yaml (params + exits). weight=1.0 everywhere.
SLEEVES = [
    dict(name="tsmom_eth", module="tsmom", market="I-ETH_INR",
         sl=0.07, ch=3.5, atrp=14,
         params={"lookback": 30, "min_return": 0.10, "near_high_frac": 0.02,
                 "regime_period": 50, "expected_move_pct": 0.08}),
    dict(name="breakout_btc", module="momentum", market="I-BTC_INR",
         sl=0.07, ch=3.5, atrp=14,
         params={"lookback": 20, "atr_period": 14, "vol_period": 20, "min_atr_frac": 0.01,
                 "vol_mult": 1.0, "buffer": 0.002, "max_chase": 0.05,
                 "regime_period": 50, "expected_move_pct": 0.08}),
    dict(name="turtle55_xrp", module="momentum", market="I-XRP_INR",
         sl=0.07, ch=3.5, atrp=14,
         params={"lookback": 55, "atr_period": 14, "vol_period": 20, "min_atr_frac": 0.01,
                 "vol_mult": 1.0, "buffer": 0.002, "max_chase": 0.05,
                 "regime_period": 100, "expected_move_pct": 0.08}),
    dict(name="macd_bnb", module="macd_trend", market="I-BNB_INR",
         sl=0.07, ch=3.5, atrp=14,
         params={"fast": 12, "slow": 26, "signal": 9, "confirm_bars": 3,
                 "require_positive": True, "regime_period": 50, "expected_move_pct": 0.08}),
    dict(name="regime_doge", module="trend_regime", market="I-DOGE_INR",
         sl=0.10, ch=0.0, atrp=14,
         params={"period": 100, "band": 0.02, "slope_bars": 5, "expected_move_pct": 0.10}),
    dict(name="ichimoku_ada", module="ichimoku", market="I-ADA_INR",
         sl=0.07, ch=0.0, atrp=14,
         params={"tenkan": 9, "kijun": 26, "senkou_b": 52, "confirm_bars": 3,
                 "expected_move_pct": 0.08}),
    dict(name="macd_sol", module="macd_trend", market="I-SOL_INR",
         sl=0.07, ch=3.5, atrp=14,
         params={"fast": 12, "slow": 26, "signal": 9, "confirm_bars": 3,
                 "require_positive": True, "regime_period": 50, "expected_move_pct": 0.08}),
]

ALLOC = 0.97  # allocation_frac from config.yaml


def load_csv(path: str) -> list[dict]:
    with gzip.open(path, "rt", newline="") as f:
        return [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
                 "low": float(r["low"]), "close": float(r["close"]),
                 "volume": float(r["volume"])} for r in csv.DictReader(f)]


def twin(market: str) -> str:
    """I-XXX_INR -> B-XXX_USDT (the venue-robustness twin)."""
    asset = market.split("-", 1)[1].split("_", 1)[0]
    return f"B-{asset}_USDT"


def load_all(venue: str = "inr") -> tuple[list[int], dict[str, dict[int, dict]]]:
    """(sorted union of daily timestamps, market -> {ts: bar}). venue='usdt' loads each
    sleeve's USDT twin but keys it under the INR market name, so the same SLEEVES table
    (and the BTC overlay's I-BTC_INR series) run unchanged against the twin venue."""
    by_market: dict[str, dict[int, dict]] = {}
    for s in SLEEVES:
        src = s["market"] if venue == "inr" else twin(s["market"])
        p = os.path.join(DATA, f"{src}_1d.csv.gz")
        by_market[s["market"]] = {b["time"]: b for b in load_csv(p)}
    days = sorted(set().union(*[set(v) for v in by_market.values()]))
    return days, by_market


def sma(vals: list[float], n: int) -> float | None:
    if len(vals) < n:
        return None
    return sum(vals[-n:]) / n


def realized_vol_ann(closes: list[float], n: int = 20) -> float | None:
    if len(closes) < n + 1:
        return None
    rets = [closes[i] / closes[i - 1] - 1 for i in range(len(closes) - n, len(closes))]
    m = sum(rets) / n
    var = sum((r - m) ** 2 for r in rets) / (n - 1)
    return math.sqrt(var) * math.sqrt(365)


def simulate(days: list[int], by_market: dict[str, dict[int, dict]], *,
             capital: float = 7000.0,
             weights: dict[str, float] | None = None,
             max_new_entries_per_day: int = 0,       # 0 = uncapped (baseline)
             same_day_scale: bool = False,           # k same-day entries -> 1/sqrt(k) size
             vol_target: float = 0.0,                # e.g. 0.6 = 60% ann.; 0 = off
             btc_filter_mult: float | None = None,   # entry size mult when BTC < 100d SMA
             cooldown_bars: int = 0,                 # re-entry cooldown after STOP_LOSS
             crash_brake: bool = False,              # hard stop on bar LOWS (gap-aware)
             max_consec_losses: int = 0,             # halt new entries after N straight losses
             ladder_frac: float = 0.0,               # regime engines: sell this frac at a
                                                     # 3.5xATR chandelier, rest on own signal
             ) -> dict:
    """One joint pass over the aligned daily history. Portfolio cash is shared; each
    sleeve sizes entries as weight_frac * marked equity (capped by cash), exactly like
    the live engine's sleeve model. Exit precedence per bar matches bot/backtest.run:
    protective exit first (overrides the signal), then the strategy's own signal."""
    slip = costs.slippage()
    w = weights or {s["name"]: 1.0 for s in SLEEVES}
    total_w = sum(w.values())
    frac = {n: ALLOC * v / total_w for n, v in w.items()}

    strats = {s["name"]: REGISTRY[s["module"]](s["name"], s["market"], s["params"])
              for s in SLEEVES}
    hist: dict[str, list[dict]] = {s["market"]: [] for s in SLEEVES}
    pos = {s["name"]: dict(qty=0.0, avg=0.0, peak=0.0, spend=0.0, cooldown=0, laddered=False)
           for s in SLEEVES}
    cash = capital
    equity_curve: list[float] = []
    trades: list[float] = []
    fees = 0.0
    consec_losses = 0
    entries_deferred = 0
    entries_scaled = 0
    stops_intraday = 0

    btc_closes: list[float] = []
    btc_bars = by_market.get("I-BTC_INR", {})

    def _mark() -> float:
        eq = cash
        for s in SLEEVES:
            p = pos[s["name"]]
            h = hist[s["market"]]
            if p["qty"] > 0 and h:
                eq += p["qty"] * h[-1]["close"]
        return eq

    def _sell(p: dict, px: float) -> float:
        nonlocal fees
        gross = p["qty"] * px * (1 - slip)
        fee = costs.trading_fee(gross)
        t = costs.tds("sell", gross)
        fees += fee + t
        return gross - fee - t

    def _close(name: str, p: dict, px: float) -> float:
        nonlocal cash, consec_losses
        proceeds = _sell(p, px)
        pnl = proceeds - p["spend"]
        trades.append(pnl)
        consec_losses = consec_losses + 1 if pnl < 0 else 0
        cash += proceeds
        p.update(qty=0.0, avg=0.0, peak=0.0, spend=0.0, laddered=False)
        return pnl

    for day in days:
        # 1) advance history + protective exits (close-based, same precedence as live)
        for s in SLEEVES:
            bar = by_market[s["market"]].get(day)
            if bar is None:
                continue
            hist[s["market"]].append(bar)
            p = pos[s["name"]]
            if p["cooldown"] > 0:
                p["cooldown"] -= 1
            if p["qty"] <= 0:
                continue
            stop_level = p["avg"] * (1 - s["sl"]) if s["sl"] else 0.0
            # optional intraday crash brake: the hard stop acts on the bar's LOW, filling
            # at the stop level - or at the OPEN when the bar gaps straight through it.
            if crash_brake and stop_level and bar["low"] <= stop_level:
                fill = min(bar["open"], stop_level) if bar["open"] <= stop_level else stop_level
                _close(s["name"], p, fill)
                stops_intraday += 1
                if cooldown_bars:
                    p["cooldown"] = cooldown_bars
                continue
            price = bar["close"]
            p["peak"] = max(p["peak"], price)
            hit = None
            if stop_level and price <= stop_level:
                hit = "STOP_LOSS"
            elif s["ch"]:
                a = atr(hist[s["market"]][-WINDOW:], s["atrp"]) or 0.0
                if a and price <= p["peak"] - s["ch"] * a:
                    hit = "CHANDELIER"
            elif ladder_frac and not p["laddered"]:
                # partial-exit ladder for the regime-holding engines (no chandelier of
                # their own): bank `ladder_frac` at a 3.5xATR trail, ride the rest to
                # the engine's own exit.
                a = atr(hist[s["market"]][-WINDOW:], s["atrp"]) or 0.0
                if a and price <= p["peak"] - 3.5 * a:
                    part_qty = p["qty"] * ladder_frac
                    gross = part_qty * price * (1 - slip)
                    fee = costs.trading_fee(gross)
                    t = costs.tds("sell", gross)
                    fees += fee + t
                    part_spend = p["spend"] * ladder_frac
                    pnl = (gross - fee - t) - part_spend
                    trades.append(pnl)
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    cash += gross - fee - t
                    p["qty"] -= part_qty
                    p["spend"] -= part_spend
                    p["laddered"] = True
            if hit:
                _close(s["name"], p, price)
                p["laddered"] = False
                if hit == "STOP_LOSS" and cooldown_bars:
                    p["cooldown"] = cooldown_bars
        if day in btc_bars:
            btc_closes.append(btc_bars[day]["close"])

        # 2) signals: sells first (frees cash), then collect buys
        buys: list[dict] = []
        for s in SLEEVES:
            bar = by_market[s["market"]].get(day)
            if bar is None:
                continue
            window = hist[s["market"]][-WINDOW:]
            strat = strats[s["name"]]
            if len(window) < max(strat.min_candles + 1, 2):
                continue
            action = strat.decide(window)
            p = pos[s["name"]]
            if action == "SELL" and p["qty"] > 0:
                _close(s["name"], p, bar["close"])
            elif action == "BUY" and p["qty"] == 0 and p["cooldown"] == 0:
                buys.append(s)

        # 3) entries, with the portfolio-level intelligence under study
        if not buys:
            equity_curve.append(_mark())
            continue
        if max_consec_losses and consec_losses >= max_consec_losses:
            equity_curve.append(_mark())
            continue
        if max_new_entries_per_day and len(buys) > max_new_entries_per_day:
            entries_deferred += len(buys) - max_new_entries_per_day
            buys = buys[:max_new_entries_per_day]
        scale = 1.0 / math.sqrt(len(buys)) if same_day_scale and len(buys) > 1 else 1.0
        if scale < 1.0:
            entries_scaled += len(buys)
        btc_mult = 1.0
        if btc_filter_mult is not None:
            line = sma(btc_closes, 100)
            if line is not None and btc_closes and btc_closes[-1] < line:
                btc_mult = btc_filter_mult
        if btc_mult == 0.0:
            equity_curve.append(_mark())
            continue
        eq = _mark()
        for s in buys:
            bar = by_market[s["market"]][day]
            price = bar["close"]
            mult = scale * btc_mult
            if vol_target:
                closes = [b["close"] for b in hist[s["market"]]]
                rv = realized_vol_ann(closes)
                if rv and rv > vol_target:
                    mult *= vol_target / rv
            notional = min(frac[s["name"]] * eq * mult, cash)
            if notional <= 1.0:
                continue
            fill = price * (1 + slip)
            fee = costs.trading_fee(notional)
            fees += fee
            qty = (notional - fee) / fill
            p = pos[s["name"]]
            p.update(qty=qty, avg=fill, peak=price, spend=notional, laddered=False)
            cash -= notional
        equity_curve.append(_mark())

    # liquidate at the end for a comparable final number
    final = cash
    for s in SLEEVES:
        p = pos[s["name"]]
        if p["qty"] > 0:
            final += _sell(p, hist[s["market"]][-1]["close"])
            trades.append(0.0)  # open at end; P&L folded into final equity

    peak = equity_curve[0] if equity_curve else capital
    max_dd = 0.0
    for e in equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak if peak else 0.0)
    wins = [t for t in trades if t > 0]
    losses = [t for t in trades if t < 0]
    return {
        "return_pct": round((final - capital) / capital * 100, 1),
        "max_dd_pct": round(max_dd * 100, 1),
        "trades": len(trades),
        "win_rate": round(len(wins) / len(trades) * 100, 0) if trades else 0.0,
        "pf": round(sum(wins) / abs(sum(losses)), 2) if losses else float("inf"),
        "fees_pct": round(fees / capital * 100, 1),
        "deferred": entries_deferred,
        "scaled": entries_scaled,
        "intraday_stops": stops_intraday,
    }


def walk_forward(days, by_market, fold_bars: int = 200, warmup: int = 160, **kw) -> list[float]:
    """Portfolio walk-forward: non-overlapping fold windows, each preceded by `warmup`
    bars of indicator history; the portfolio starts FLAT each fold and only the fold
    window is scored. Returns per-fold portfolio returns."""
    rets = []
    start = warmup
    while start + fold_bars <= len(days):
        seg = days[start - warmup: start + fold_bars]
        seg_markets = {m: {d: bars[d] for d in seg if d in bars}
                       for m, bars in by_market.items()}
        # score only the fold: run warmup+fold, then subtract the warmup-only run's
        # contribution by scoring a run whose entries are disabled before the fold.
        res = simulate(seg, seg_markets, **kw)
        rets.append(res["return_pct"])
        start += fold_bars
    return rets


_HDR = (f"{'config':34} {'net%':>8} {'maxDD%':>7} {'trades':>6} {'win%':>5} {'pf':>6} "
        f"{'fees%':>6}  extra")


def _row(name: str, r: dict, extra: str = "") -> None:
    print(f"{name:34} {r['return_pct']:>8} {r['max_dd_pct']:>7} {r['trades']:>6} "
          f"{r['win_rate']:>5} {r['pf']:>6} {r['fees_pct']:>6}  {extra}")


def _wf_row(name: str, days, by_market, **kw) -> None:
    folds = walk_forward(days, by_market, **kw)
    pos = sum(1 for f in folds if f > 0)
    comp = 1.0
    for f in folds:
        comp *= 1 + f / 100
    print(f"  WF {name:31} folds={['%+.1f' % f for f in folds]} "
          f"positive={pos}/{len(folds)} compounded={100*(comp-1):+.1f}%")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--study", default="all",
                    choices=["all", "entries", "vol", "btc", "cooldown", "brake",
                             "consec", "weights", "ladder"])
    ap.add_argument("--capital", type=float, default=7000.0)
    ap.add_argument("--venue", default="inr", choices=["inr", "usdt"],
                    help="usdt = replay the same lineup on the USDT twins (robustness)")
    ap.add_argument("--no-wf", action="store_true", help="skip walk-forward folds (faster)")
    a = ap.parse_args()

    days, by_market = load_all(a.venue)
    print(f"loaded {len(days)} aligned daily bars across {len(by_market)} "
          f"{a.venue.upper()} markets\n")
    print(_HDR)
    print("-" * len(_HDR))

    cap = dict(capital=a.capital)
    base = simulate(days, by_market, **cap)
    _row("baseline (v6, equal weights)", base)

    def run(tag: str, extra_key: str = "", **kw):
        r = simulate(days, by_market, **cap, **kw)
        _row(tag, r, f"{extra_key}={r[extra_key]}" if extra_key else "")
        if not a.no_wf:
            _wf_row(tag, days, by_market, **kw)
        return r

    st = a.study
    if st in ("all", "entries"):
        if not a.no_wf:
            _wf_row("baseline", days, by_market)
        run("entry cap 1/day", "deferred", max_new_entries_per_day=1)
        run("entry cap 2/day", "deferred", max_new_entries_per_day=2)
        run("same-day 1/sqrt(k) sizing", "scaled", same_day_scale=True)
    if st in ("all", "vol"):
        run("vol-target 40% ann", vol_target=0.40)
        run("vol-target 60% ann", vol_target=0.60)
        run("vol-target 80% ann", vol_target=0.80)
    if st in ("all", "btc"):
        run("BTC<100d -> half-size entries", btc_filter_mult=0.5)
        run("BTC<100d -> no new entries", btc_filter_mult=0.0)
    if st in ("all", "cooldown"):
        run("cooldown 2 bars after stop", cooldown_bars=2)
        run("cooldown 5 bars after stop", cooldown_bars=5)
    if st in ("all", "brake"):
        run("intraday crash brake (lows)", "intraday_stops", crash_brake=True)
        run("crash brake + cooldown 2", "intraday_stops", crash_brake=True, cooldown_bars=2)
    if st in ("all", "consec"):
        run("halt after 3 straight losses", max_consec_losses=3)
        run("halt after 5 straight losses", max_consec_losses=5)
    if st in ("all", "ladder"):
        run("regime ladder: sell 1/2 at trail", ladder_frac=0.5)
        run("regime ladder: sell 1/3 at trail", ladder_frac=1 / 3)
    if st in ("all", "weights"):
        # presets derived from the v6 per-sleeve evidence (FINDINGS): conservative
        # tilts to the best fold records / shallowest DDs, aggressive to raw net.
        conservative = {"tsmom_eth": 1.2, "breakout_btc": 1.2, "turtle55_xrp": 0.8,
                        "macd_bnb": 1.4, "regime_doge": 0.8, "ichimoku_ada": 0.8,
                        "macd_sol": 0.8}
        aggressive = {"tsmom_eth": 1.2, "breakout_btc": 0.6, "turtle55_xrp": 1.4,
                      "macd_bnb": 1.4, "regime_doge": 1.2, "ichimoku_ada": 0.6,
                      "macd_sol": 0.6}
        run("weights: conservative preset", weights=conservative)
        run("weights: aggressive preset", weights=aggressive)


if __name__ == "__main__":
    main()
