"""v9 study: multi-cycle, two-venue re-validation of every strategy template.

Why a new study: every earlier verdict (v3-v8) was measured on ~2.8 years of daily
bars (2023-09 .. 2026-07) - a window that is mostly one bull market. v9 replays the
SAME engine (bot.backtest.run, same exits, same cost model) on:

  coindcx   the clean CoinDCX INR daily history (from ~2020-12; XRP from 2019-05 -
            older INR bars are corrupt and are trimmed by scripts/fetch_history.py
            --deep against the Binance twin), at CoinDCX friction: 0.2% fee + 18%
            GST per side, 1% TDS on every sell, 5 bps slippage (~1.67% round trip).
  binance   Binance USDT dailies since listing (2017-08 onward for BTC/ETH) for 12
            coins, at Binance spot friction: 0.1% fee + 18% GST per side (India GST
            on exchange fees since July 2025), no TDS withheld by the venue, 5 bps
            slippage (~0.34% round trip).

The Binance window includes the 2018 and 2022 bear markets and the 2019/2023 chop, the
INR window the 2022 bear - periods the earlier studies never saw. Every candidate
starts flat on the same bar (after a common warm-up) so buy-and-hold and every
strategy cover an identical span.

Usage:
  python -m research.v9_study                     # full grid, both venues
  python -m research.v9_study --venue binance --only donchian
  python -m research.v9_study --json research/results/v9.json
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import json
import math
import os
import statistics as st
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "strattice", "worker"))

from bot import costs  # noqa: E402
from bot.backtest import run  # noqa: E402
from bot.strategies import REGISTRY  # noqa: E402

DEEP = os.path.join(ROOT, "research", "data", "deep")
WARMUP = 250          # bars every run spends warming indicators before trading starts
CAPITAL = 1000.0

VENUES = {
    "coindcx": {"pattern": "I-*_INR_1d.csv.gz",
                "costs": {"fee_rate": 0.002, "gst_on_fee": 0.18, "tds_rate": 0.01,
                          "slippage_bps": 5.0, "edge_margin_pct": 0.002}},
    "binance": {"pattern": "BN-*_USDT_1d.csv.gz",
                "costs": {"fee_rate": 0.001, "gst_on_fee": 0.18, "tds_rate": 0.0,
                          "slippage_bps": 5.0, "edge_margin_pct": 0.002}},
}

TREND = {"stop_loss_pct": 0.07, "chandelier_k": 3.5, "atr_period": 14}
HOLDER = {"stop_loss_pct": 0.10, "chandelier_k": 0.0, "atr_period": 14}


def candidates() -> dict[str, dict]:
    """name -> {module, params, exits}. Current templates at their shipped defaults
    (worker/config_gen.py), the research/retired modules at their study defaults, and
    the v9 newcomers over a small, pre-declared grid (no post-hoc tuning)."""
    import config_gen
    c: dict[str, dict] = {}
    for tpl, d in config_gen.TEMPLATE_DEFAULTS.items():
        if tpl in ("custom", "hf_forecast", "donchian_ls", "ensemble_ls"):
            continue  # needs a rule def / a model / short side - not comparable here
        c[tpl] = {"module": tpl, "params": dict(d["params"]),
                  "exits": {"stop_loss_pct": d["stop_loss_pct"],
                            "take_profit_pct": d["take_profit_pct"],
                            "chandelier_k": d["chandelier_k"],
                            "atr_period": d["atr_period"],
                            "max_hold_bars": d["max_hold_bars"]}}
    # research-only modules from earlier studies (defaults from research/run_backtests.py)
    c["kama_trend"] = {"module": "kama_trend", "exits": {"stop_loss_pct": 0.07},
                       "params": {"er_period": 10, "fast": 2, "slow": 30, "entry_band": 0.01,
                                  "exit_band": 0.01, "slope_bars": 3, "min_er": 0.30,
                                  "regime_period": 50, "expected_move_pct": 0.08}}
    c["adx_trend"] = {"module": "adx_trend", "exits": dict(TREND),
                      "params": {"period": 14, "min_adx": 20, "confirm_bars": 3,
                                 "regime_period": 50, "expected_move_pct": 0.08}}
    c["acceleration"] = {"module": "acceleration", "exits": dict(TREND),
                         "params": {"fast": 10, "min_return": 0.08, "accel_mult": 1.5,
                                    "breakout_lookback": 20, "vol_period": 20,
                                    "vol_mult": 1.0, "regime_period": 50,
                                    "expected_move_pct": 0.08}}
    c["capitulation"] = {"module": "capitulation",
                         "exits": {"stop_loss_pct": 0.10, "take_profit_pct": 0.15,
                                   "max_hold_bars": 20},
                         "params": {"crash_lookback": 10, "crash_drop": 0.15,
                                    "max_drop": 0.50, "rsi_period": 14, "oversold": 25,
                                    "vol_period": 20, "vol_mult": 1.2,
                                    "expected_move_pct": 0.06}}
    c["trend_ensemble"] = {"module": "trend_ensemble", "exits": dict(TREND),
                           "params": {"lookbacks": [10, 20, 40, 80, 160],
                                      "min_agree_frac": 0.8, "confirm_bars": 3,
                                      "regime_period": 50, "expected_move_pct": 0.08}}
    # turtle55 = momentum with the 55-day window the live XRP sleeve runs
    c["turtle55"] = {"module": "momentum", "exits": dict(TREND),
                     "params": {**config_gen.TEMPLATE_DEFAULTS["momentum"]["params"],
                                "lookback": 55, "regime_period": 100}}
    # trend_regime on the classic 200-day line, for comparison with the shipped 100d
    c["trend_regime_200"] = {"module": "trend_regime", "exits": dict(HOLDER),
                             "params": {"period": 200, "band": 0.02, "slope_bars": 5,
                                        "expected_move_pct": 0.10}}

    # ---- v9 newcomers (pre-declared grids) ----
    for e, x in ((20, 10), (55, 20), (100, 50)):
        for reg in (0, 100):
            c[f"donchian_{e}_{x}" + ("_r" if reg else "")] = {
                "module": "donchian_trend", "exits": dict(HOLDER),
                "params": {"entry_lookback": e, "exit_lookback": x, "regime_period": reg,
                           "expected_move_pct": 0.10}}
    for lb, fast in ((60, 20), (90, 20), (180, 30)):
        c[f"absmom_{lb}"] = {"module": "abs_momentum", "exits": dict(HOLDER),
                             "params": {"lookback": lb, "fast": fast, "entry_return": 0.05,
                                        "exit_return": 0.0, "expected_move_pct": 0.10}}
    for exit_k in (0.0, -1.0):
        for reg in (0, 100):
            c[f"bbbo_{'mid' if exit_k == 0 else 'low1'}" + ("_r" if reg else "")] = {
                "module": "bb_breakout", "exits": dict(HOLDER),
                "params": {"period": 20, "k": 2.0, "exit_k": exit_k, "regime_period": reg,
                           "expected_move_pct": 0.08}}
    return c


def load(path: str) -> list[dict]:
    with gzip.open(path, "rt", newline="") as f:
        return [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
                 "low": float(r["low"]), "close": float(r["close"]),
                 "volume": float(r["volume"])} for r in csv.DictReader(f)]


def market_of(path: str) -> str:
    return os.path.basename(path)[:-len("_1d.csv.gz")]


def _year(ms: int) -> int:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).year


def yearly_returns(curve: list[tuple[int, float]]) -> dict[int, float]:
    """Calendar-year % returns of a continuous equity curve (first/last bar per year)."""
    out: dict[int, float] = {}
    prev_end = None
    for y in sorted({_year(t) for t, _ in curve}):
        pts = [e for t, e in curve if _year(t) == y]
        start = prev_end if prev_end is not None else pts[0]
        out[y] = (pts[-1] / start - 1) * 100 if start else 0.0
        prev_end = pts[-1]
    return out


def _cagr(final: float, start: float, bars: int) -> float:
    years = bars / 365.0
    if years <= 0 or start <= 0 or final <= 0:
        return -100.0
    return ((final / start) ** (1 / years) - 1) * 100


def buy_hold(candles: list[dict]) -> dict:
    seg = candles[WARMUP:]
    curve = [(b["time"], b["close"] / seg[0]["close"] * CAPITAL) for b in seg]
    peak, dd = curve[0][1], 0.0
    for _, e in curve:
        peak = max(peak, e)
        dd = max(dd, (peak - e) / peak)
    return {"return_pct": round((curve[-1][1] / CAPITAL - 1) * 100, 1),
            "cagr": round(_cagr(curve[-1][1], CAPITAL, len(curve)), 1),
            "max_drawdown_pct": round(dd * 100, 1),
            "years": yearly_returns(curve)}


SPLIT_MS = int(datetime(2023, 9, 1, tzinfo=timezone.utc).timestamp() * 1000)


class BtcGate:
    """The shipped portfolio overlay (config portfolio.btc_regime_filter, default ON):
    a BUY is downgraded to HOLD while the venue's BTC closes under its 100-day SMA.
    Exits are never touched - identical to Engine._overlay_mult with entry_mult 0."""

    def __init__(self, inner, risk_on: set[int]):
        self.inner, self.risk_on = inner, risk_on
        self.name, self.min_candles = inner.name, inner.min_candles
        self.context = getattr(inner, "context", 0)

    def decide(self, window):
        a = self.inner.decide(window)
        if a == "BUY" and window[-1]["time"] not in self.risk_on:
            return "HOLD"
        return a


def btc_risk_on(venue: str, period: int = 100) -> set[int]:
    path = os.path.join(DEEP, "BN-BTC_USDT_1d.csv.gz" if venue == "binance"
                        else "I-BTC_INR_1d.csv.gz")
    bars = load(path)
    closes = [b["close"] for b in bars]
    return {bars[i]["time"] for i in range(period - 1, len(bars))
            if closes[i] >= sum(closes[i - period + 1:i + 1]) / period}


_RISK_ON: dict[str, set[int]] = {}


def _period_return(curve, lo: int, hi: int) -> float | None:
    pts = [e for t, e in curve if lo <= t < hi]
    if len(pts) < 30:
        return None
    return (pts[-1] / pts[0] - 1) * 100


def _job(args):
    venue, path, name, spec = args
    costs._cache = {**costs._DEFAULTS, **VENUES[venue]["costs"]}  # venue friction everywhere
    candles = load(path)
    strat = REGISTRY[spec["module"]](name, market_of(path), spec["params"])
    if spec.get("btc_gate"):
        if venue not in _RISK_ON:
            _RISK_ON[venue] = btc_risk_on(venue)
        strat = BtcGate(strat, _RISK_ON[venue])
    ex = spec["exits"]
    r = run(strat, candles, CAPITAL, interval="1d", trade_from=WARMUP, curve=True,
            stop_loss_pct=ex.get("stop_loss_pct", 0.0),
            take_profit_pct=ex.get("take_profit_pct", 0.0),
            chandelier_k=ex.get("chandelier_k", 0.0),
            atr_period=ex.get("atr_period", 14),
            max_hold_bars=ex.get("max_hold_bars", 0))
    curve = r.pop("curve")
    years = yearly_returns(curve)
    bars = len(curve)
    return venue, market_of(path), name, {
        **{k: r[k] for k in ("return_pct", "trades", "win_rate", "profit_factor",
                             "max_drawdown_pct", "sharpe_annualized",
                             "fees_pct_of_capital", "exposure_pct")},
        "cagr": round(_cagr(r["final_equity"], CAPITAL, bars), 2),
        "trades_per_year": round(r["trades"] / (bars / 365.0), 2),
        "years": {str(y): round(v, 1) for y, v in years.items()},
        # 2023-09 is where every earlier study's data began: before it is genuinely
        # out-of-sample for the shipped defaults, after it is the window they were fit on
        "ret_pre": _period_return(curve, 0, SPLIT_MS),
        "ret_post": _period_return(curve, SPLIT_MS, 1 << 62),
    }


def _med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 1) if xs else None


def summarize(results: dict, bh: dict) -> dict:
    """Per (venue, candidate): cross-market medians + robustness counts."""
    out: dict = {}
    for venue, by_mkt in results.items():
        names = sorted({n for m in by_mkt.values() for n in m})
        for name in names:
            rows = [(m, by_mkt[m][name]) for m in by_mkt if name in by_mkt[m]]
            cagr = [r["cagr"] for _, r in rows]
            dd = [r["max_drawdown_pct"] for _, r in rows]
            sh = [r["sharpe_annualized"] for _, r in rows]
            yrs_pos = yrs_tot = 0
            bear = []
            beat_bh_sharpe = 0
            for m, r in rows:
                ys = {int(y): v for y, v in r["years"].items()}
                full = [y for y in ys if y not in (min(ys), max(ys))]  # partial years out
                yrs_tot += len(full)
                yrs_pos += sum(1 for y in full if ys[y] > 0)
                bear += [ys[y] for y in (2018, 2022) if y in full]
                if r["cagr"] / max(r["max_drawdown_pct"], 1) > \
                        bh[venue][m]["cagr"] / max(bh[venue][m]["max_drawdown_pct"], 1):
                    beat_bh_sharpe += 1
            out.setdefault(venue, {})[name] = {
                "markets": len(rows),
                "median_cagr": round(st.median(cagr), 1),
                "markets_positive": sum(1 for x in cagr if x > 0),
                "median_maxdd": round(st.median(dd), 1),
                "median_sharpe": round(st.median(sh), 2),
                "median_pf": round(st.median(min(r["profit_factor"], 99) for _, r in rows), 2),
                "years_positive": f"{yrs_pos}/{yrs_tot}",
                "years_positive_pct": round(yrs_pos / yrs_tot * 100, 1) if yrs_tot else 0.0,
                "median_bear_year": round(st.median(bear), 1) if bear else None,
                "beats_bh_mar": f"{beat_bh_sharpe}/{len(rows)}",
                "median_trades_per_year": round(st.median(r["trades_per_year"]
                                                          for _, r in rows), 1),
                "median_fees_pct": round(st.median(r["fees_pct_of_capital"]
                                                   for _, r in rows), 1),
                "median_ret_pre": _med([r["ret_pre"] for _, r in rows]),
                "median_ret_post": _med([r["ret_post"] for _, r in rows]),
            }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--venue", choices=sorted(VENUES), action="append")
    ap.add_argument("--only", help="substring filter on candidate names")
    ap.add_argument("--json", help="write full results here")
    ap.add_argument("--no-gate", action="store_true",
                    help="skip the BTC-overlay (+btc) variants")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    a = ap.parse_args()
    venues = a.venue or sorted(VENUES)
    cands = {k: v for k, v in candidates().items() if not a.only or a.only in k}

    jobs, bh = [], {}
    for venue in venues:
        for path in sorted(glob.glob(os.path.join(DEEP, VENUES[venue]["pattern"]))):
            bh.setdefault(venue, {})[market_of(path)] = buy_hold(load(path))
            jobs += [(venue, path, n, s) for n, s in cands.items()]
            if not a.no_gate:
                jobs += [(venue, path, n + "+btc", {**s, "btc_gate": True})
                         for n, s in cands.items()]
    results: dict = {}
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for venue, mkt, name, r in pool.map(_job, jobs, chunksize=4):
            results.setdefault(venue, {}).setdefault(mkt, {})[name] = r
    summary = summarize(results, bh)

    for venue in venues:
        b = bh[venue]
        print(f"\n=== {venue}: buy & hold (same span) ===")
        for m, r in sorted(b.items()):
            print(f"  {m:14} ret {r['return_pct']:>9}%  CAGR {r['cagr']:>6}%  "
                  f"maxDD {r['max_drawdown_pct']:>5}%")
        print(f"\n=== {venue}: candidates ranked by median CAGR ===")
        hdr = (f"{'candidate':22} {'medCAGR':>7} {'pos':>5} {'medDD':>6} {'medSh':>6} "
               f"{'medPF':>6} {'yrs+':>9} {'bear':>7} {'MAR>BH':>7} {'tr/yr':>6} {'fee%':>6} "
               f"{'pre23':>7} {'post23':>7}")
        print(hdr)
        for name, s in sorted(summary[venue].items(), key=lambda kv: -kv[1]["median_cagr"]):
            print(f"{name:22} {s['median_cagr']:>7} {s['markets_positive']:>2}/{s['markets']:<2} "
                  f"{s['median_maxdd']:>6} {s['median_sharpe']:>6} {s['median_pf']:>6} "
                  f"{s['years_positive']:>9} {str(s['median_bear_year']):>7} "
                  f"{s['beats_bh_mar']:>7} {s['median_trades_per_year']:>6} "
                  f"{s['median_fees_pct']:>6} {str(s['median_ret_pre']):>7} "
                  f"{str(s['median_ret_post']):>7}")
    if a.json:
        os.makedirs(os.path.dirname(a.json) or ".", exist_ok=True)
        with open(a.json, "w") as f:
            json.dump({"buy_hold": bh, "results": results, "summary": summary,
                       "venues": {v: VENUES[v]["costs"] for v in venues},
                       "warmup_bars": WARMUP}, f, indent=1, default=str)
        print(f"\nwrote {a.json}")


if __name__ == "__main__":
    main()
