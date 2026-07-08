"""Batch strategy research runner. Replays every candidate (strategy, params, exits,
market, interval) through bot.backtest.run — the SAME engine + cost model the bot uses —
against the CSV history snapshots in research/data/ (fetched by CI, see
scripts/fetch_history.py). Emits one compact metrics table + walk-forward folds so
keep/kill decisions are made on out-of-sample net expectancy, not one lucky window.

Usage:
  python -m research.run_backtests                 # full grid
  python -m research.run_backtests --json out.json # machine-readable dump
"""
import argparse
import csv
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.backtest import run, walk_forward  # noqa: E402
from bot.strategies import REGISTRY          # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load_csv(path: str) -> list[dict]:
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", newline="") as f:
        return [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
                 "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["volume"])}
                for r in csv.DictReader(f)]


def resample(candles: list[dict], factor: int) -> list[dict]:
    """Aggregate N consecutive bars into one (e.g. 1h -> 4h with factor=4)."""
    out = []
    for i in range(0, len(candles) - factor + 1, factor):
        w = candles[i:i + factor]
        out.append({"time": w[0]["time"], "open": w[0]["open"],
                    "high": max(c["high"] for c in w), "low": min(c["low"] for c in w),
                    "close": w[-1]["close"], "volume": sum(c["volume"] for c in w)})
    return out


def available() -> dict[tuple[str, str], str]:
    """(pair, interval) -> csv path for everything the CI snapshot fetched."""
    out = {}
    for p in sorted(glob.glob(os.path.join(DATA, "*.csv.gz"))):
        base = os.path.basename(p)[:-len(".csv.gz")]
        pair, interval = base.rsplit("_", 1)
        out[(pair, interval)] = p
    return out


# Candidate grid. Each entry: name, module, params, engine exits, interval.
# Periods are expressed in BARS of the given interval.
def candidates() -> list[dict]:
    c = []

    def add(name, module, interval, params, **exits):
        c.append({"name": name, "module": module, "interval": interval,
                  "params": params, "exits": {
                      "stop_loss_pct": exits.get("sl", 0.0),
                      "take_profit_pct": exits.get("tp", 0.0),
                      "chandelier_k": exits.get("ch", 0.0),
                      "atr_period": exits.get("atrp", 14),
                      "max_hold_bars": exits.get("hold", 0)}})

    # --- current config (15m expressions) ---
    add("cfg_ma_15m", "ma_crossover", "15m",
        {"fast": 32, "slow": 96, "atr_period": 16, "k_atr": 0.5, "confirm_bars": 4,
         "regime_period": 192, "expected_move_pct": 0.05},
        sl=0.04, ch=3.0, atrp=16)
    add("cfg_rsi_15m", "rsi", "15m",
        {"period": 14, "oversold": 22, "regime_period": 192, "expected_move_pct": 0.05},
        sl=0.03, tp=0.03, hold=64, atrp=16)
    add("cfg_breakout_15m", "momentum", "15m",
        {"lookback": 32, "atr_period": 16, "vol_period": 32, "min_atr_frac": 0.005,
         "vol_mult": 1.2, "buffer": 0.002, "max_chase": 0.02, "regime_period": 96,
         "expected_move_pct": 0.03},
        sl=0.04, ch=3.0, atrp=16)
    add("cfg_volexp_15m", "vol_expansion", "15m",
        {"short_atr": 8, "long_atr": 32, "expansion_mult": 1.6, "breakout_lookback": 24,
         "regime_period": 96, "expected_move_pct": 0.03},
        sl=0.025, ch=2.5, atrp=16)
    add("cfg_fastrsi_15m", "fast_rsi", "15m",
        {"period": 7, "oversold": 25, "regime_period": 96, "expected_move_pct": 0.03},
        sl=0.02, tp=0.025, hold=12, atrp=16)
    add("cfg_bbrev_15m", "bb_reversion", "15m",
        {"period": 20, "k": 2.0, "z_entry": 2.0, "regime_period": 96,
         "expected_move_pct": 0.03},
        sl=0.03, tp=0.04, hold=32, atrp=16)
    add("cfg_squeeze_15m", "squeeze_breakout", "15m",
        {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 16, "lookback": 20,
         "squeeze_lookback": 6, "vol_period": 32, "vol_mult": 1.2, "buffer": 0.002,
         "max_chase": 0.02, "min_atr_frac": 0.005, "regime_period": 96,
         "expected_move_pct": 0.03},
        sl=0.04, ch=3.0, atrp=16)
    add("cfg_connors_15m", "rsi", "15m",
        {"period": 2, "oversold": 10, "regime_period": 96, "expected_move_pct": 0.03},
        sl=0.03, tp=0.03, hold=24, atrp=16)

    # --- 1h re-expressions (config's original habitat, fewer bars => less churn) ---
    add("ma_1h", "ma_crossover", "1h",
        {"fast": 10, "slow": 30, "atr_period": 14, "k_atr": 0.5, "confirm_bars": 3,
         "regime_period": 120, "expected_move_pct": 0.05},
        sl=0.04, ch=3.0, atrp=14)
    add("rsi_1h", "rsi", "1h",
        {"period": 14, "oversold": 25, "regime_period": 120, "expected_move_pct": 0.05},
        sl=0.03, tp=0.03, hold=48, atrp=14)
    add("breakout_1h", "momentum", "1h",
        {"lookback": 24, "atr_period": 14, "vol_period": 24, "min_atr_frac": 0.004,
         "vol_mult": 1.2, "buffer": 0.002, "max_chase": 0.02, "regime_period": 120,
         "expected_move_pct": 0.04},
        sl=0.04, ch=3.0, atrp=14)
    add("squeeze_1h", "squeeze_breakout", "1h",
        {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 14, "lookback": 20,
         "squeeze_lookback": 8, "vol_period": 24, "vol_mult": 1.2, "buffer": 0.002,
         "max_chase": 0.02, "min_atr_frac": 0.004, "regime_period": 120,
         "expected_move_pct": 0.04},
        sl=0.04, ch=3.0, atrp=14)
    add("bbrev_1h", "bb_reversion", "1h",
        {"period": 20, "k": 2.0, "z_entry": 2.0, "regime_period": 120,
         "expected_move_pct": 0.04},
        sl=0.03, tp=0.04, hold=24, atrp=14)

    # --- 4h (resampled from 1h) & 1d: swing altitude where 1.5% friction amortizes ---
    add("ma_4h", "ma_crossover", "4h",
        {"fast": 12, "slow": 40, "atr_period": 14, "k_atr": 0.3, "confirm_bars": 3,
         "regime_period": 42, "expected_move_pct": 0.06},
        sl=0.05, ch=3.0, atrp=14)
    add("breakout_4h", "momentum", "4h",
        {"lookback": 30, "atr_period": 14, "vol_period": 30, "min_atr_frac": 0.006,
         "vol_mult": 1.1, "buffer": 0.002, "max_chase": 0.03, "regime_period": 42,
         "expected_move_pct": 0.06},
        sl=0.05, ch=3.0, atrp=14)
    add("rsi_4h", "rsi", "4h",
        {"period": 14, "oversold": 30, "regime_period": 42, "expected_move_pct": 0.05},
        sl=0.05, tp=0.05, hold=18, atrp=14)
    add("ma_1d", "ma_crossover", "1d",
        {"fast": 10, "slow": 30, "atr_period": 14, "k_atr": 0.2, "confirm_bars": 3,
         "regime_period": 100, "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)
    add("breakout_1d", "momentum", "1d",
        {"lookback": 20, "atr_period": 14, "vol_period": 20, "min_atr_frac": 0.01,
         "vol_mult": 1.0, "buffer": 0.002, "max_chase": 0.05, "regime_period": 50,
         "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)
    add("rsi_1d", "rsi", "1d",
        {"period": 3, "oversold": 25, "regime_period": 50, "expected_move_pct": 0.06},
        sl=0.06, tp=0.06, hold=10, atrp=14)

    # --- new candidate: time-series momentum (buy strength, chandelier exit) ---
    add("tsmom_1h", "tsmom", "1h",
        {"lookback": 96, "min_return": 0.04, "near_high_frac": 0.01,
         "regime_period": 120, "expected_move_pct": 0.05},
        sl=0.04, ch=3.0, atrp=14)
    add("tsmom_4h", "tsmom", "4h",
        {"lookback": 42, "min_return": 0.06, "near_high_frac": 0.015,
         "regime_period": 42, "expected_move_pct": 0.06},
        sl=0.05, ch=3.0, atrp=14)
    add("tsmom_1d", "tsmom", "1d",
        {"lookback": 30, "min_return": 0.10, "near_high_frac": 0.02,
         "regime_period": 50, "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)

    # --- v4 candidates: new daily trend engines (validated July 2026) ---
    add("supertrend_1d", "supertrend", "1d",
        {"atr_period": 10, "mult": 3.0, "confirm_bars": 2,
         "regime_period": 50, "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)
    add("ensemble_1d", "trend_ensemble", "1d",
        {"lookbacks": [10, 20, 40, 80, 160], "min_agree_frac": 0.8, "confirm_bars": 3,
         "regime_period": 50, "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)
    add("squeeze_1d", "squeeze_breakout", "1d",
        {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 14, "lookback": 20,
         "squeeze_lookback": 6, "vol_period": 20, "vol_mult": 1.0, "buffer": 0.002,
         "max_chase": 0.05, "min_atr_frac": 0.01, "regime_period": 50,
         "expected_move_pct": 0.08},
        sl=0.07, ch=3.5, atrp=14)
    return c


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    ap.add_argument("--capital", type=float, default=1000.0)
    ap.add_argument("--pairs", default="", help="comma filter, e.g. I-BTC_INR,B-BTC_USDT")
    ap.add_argument("--only", default="", help="comma filter on candidate name")
    ap.add_argument("--walkforward", action="store_true")
    a = ap.parse_args()

    avail = available()
    if not avail:
        print(f"no data in {DATA}; run the fetch-market-data workflow first")
        return
    pair_filter = set(a.pairs.split(",")) if a.pairs else None
    name_filter = set(a.only.split(",")) if a.only else None

    cache: dict[tuple[str, str], list[dict]] = {}

    def candles_for(pair: str, interval: str) -> list[dict]:
        key = (pair, interval)
        if key in cache:
            return cache[key]
        rows: list[dict] = []
        if key in avail:
            rows = load_csv(avail[key])
        elif interval == "4h" and (pair, "1h") in avail:
            rows = resample(load_csv(avail[(pair, "1h")]), 4)
        cache[key] = rows
        return rows

    results = []
    hdr = (f"{'candidate':18} {'pair':13} {'iv':3} {'bars':>6} {'trades':>6} {'net%':>8} "
           f"{'pf':>6} {'win%':>5} {'exp':>8} {'dd%':>6} {'shrp':>6} {'fees%':>6} {'expo%':>5}")
    print(hdr)
    print("-" * len(hdr))
    pairs = sorted({p for (p, _i) in avail})
    for cand in candidates():
        if name_filter and cand["name"] not in name_filter:
            continue
        for pair in pairs:
            if pair_filter and pair not in pair_filter:
                continue
            candles = candles_for(pair, cand["interval"])
            strat = REGISTRY[cand["module"]](cand["name"], pair, cand["params"])
            if len(candles) < strat.min_candles + 50:
                continue
            res = run(strat, candles, a.capital, interval=cand["interval"], **cand["exits"])
            row = {"candidate": cand["name"], "pair": pair, "interval": cand["interval"],
                   "bars": len(candles), **res}
            results.append(row)
            print(f"{cand['name']:18} {pair:13} {cand['interval']:3} {len(candles):>6} "
                  f"{res['trades']:>6} {res['return_pct']:>8.2f} {res['profit_factor']:>6} "
                  f"{res['win_rate']:>5.1f} {res['expectancy']:>8.3f} "
                  f"{res['max_drawdown_pct']:>6.2f} {res['sharpe_annualized']:>6.2f} "
                  f"{res['fees_pct_of_capital']:>6.2f} {res['exposure_pct']:>5.1f}")
            if a.walkforward and res["trades"] >= 3:
                strat2 = REGISTRY[cand["module"]](cand["name"], pair, cand["params"])
                n = len(candles)
                test = max(500, n // 6)
                walk_forward(strat2, candles, a.capital, train=strat2.min_candles + 50,
                             test=test, interval=cand["interval"], **cand["exits"])

    if a.json:
        with open(a.json, "w") as f:
            json.dump(results, f, indent=1)
        print(f"\nwrote {len(results)} rows to {a.json}")


if __name__ == "__main__":
    main()
