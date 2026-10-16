"""v9 portfolio study: joint replay of candidate 7-sleeve lineups on the deep data.

Reuses research.portfolio_study.simulate (the same shared-cash sleeve model, exit
precedence and BTC overlay as the v7 study) against research/data/deep/, for both
venues at their own friction (research.v9_study.VENUES). Each lineup is scored on the
common span where all seven markets trade, with the shipped BTC 100d overlay ON, plus
yearly walk-forward folds (portfolio restarted flat each calendar year).

Run:  python -m research.v9_portfolio
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot import costs                      # noqa: E402
import research.portfolio_study as ps      # noqa: E402
from research.v9_study import DEEP, VENUES, load  # noqa: E402

COINS = ["BTC", "ETH", "XRP", "SOL", "DOGE", "BNB", "ADA"]

T = dict(sl=0.07, ch=3.5, atrp=14)        # burst-entry engines: hard stop + chandelier
H = dict(sl=0.10, ch=0.0, atrp=14)        # regime holders: own exit + disaster stop

TPL = {
    "tsmom": (T, {"lookback": 30, "min_return": 0.10, "near_high_frac": 0.02,
                  "regime_period": 50, "expected_move_pct": 0.08}),
    "momentum": (T, {"lookback": 20, "atr_period": 14, "vol_period": 20,
                     "min_atr_frac": 0.01, "vol_mult": 1.0, "buffer": 0.002,
                     "max_chase": 0.05, "regime_period": 50, "expected_move_pct": 0.08}),
    "turtle55": (T, {"lookback": 55, "atr_period": 14, "vol_period": 20,
                     "min_atr_frac": 0.01, "vol_mult": 1.0, "buffer": 0.002,
                     "max_chase": 0.05, "regime_period": 100, "expected_move_pct": 0.08}),
    "macd_trend": (T, {"fast": 12, "slow": 26, "signal": 9, "confirm_bars": 3,
                       "require_positive": True, "regime_period": 50,
                       "expected_move_pct": 0.08}),
    "trend_regime": (H, {"period": 100, "band": 0.02, "slope_bars": 5,
                         "expected_move_pct": 0.10}),
    "ichimoku": (dict(sl=0.07, ch=0.0, atrp=14),
                 {"tenkan": 9, "kijun": 26, "senkou_b": 52, "confirm_bars": 3,
                  "expected_move_pct": 0.08}),
    "vol_expansion": (T, {"short_atr": 5, "long_atr": 20, "expansion_mult": 1.3,
                          "breakout_lookback": 10, "regime_period": 50,
                          "expected_move_pct": 0.06}),
    "supertrend": (T, {"atr_period": 10, "mult": 3.0, "confirm_bars": 2,
                       "regime_period": 50, "expected_move_pct": 0.08}),
    "bb_breakout": (H, {"period": 20, "k": 2.0, "exit_k": 0.0, "regime_period": 0,
                        "expected_move_pct": 0.08}),
    "donchian_trend": (H, {"entry_lookback": 20, "exit_lookback": 10, "regime_period": 0,
                           "expected_move_pct": 0.10}),
}
_MODULE = {"turtle55": "momentum"}

LINEUPS = {
    # the shipped v6/v7 lineup (config.yaml)
    "v6 shipped": {"BTC": "momentum", "ETH": "tsmom", "XRP": "turtle55",
                   "SOL": "macd_trend", "DOGE": "trend_regime", "BNB": "macd_trend",
                   "ADA": "ichimoku"},
    # one robust template everywhere (no per-coin picking at all)
    "bb_breakout x7": {c: "bb_breakout" for c in COINS},
    "donchian_trend x7": {c: "donchian_trend" for c in COINS},
    # v9: keep each v6 incumbent that still clears the bar on BOTH venues for its coin,
    # replace the ones that do not (XRP turtle55, ADA ichimoku, SOL macd) with the
    # v9-promoted engines, so no single template holds more than two sleeves
    "v9 proposed": {"BTC": "momentum", "ETH": "tsmom", "XRP": "bb_breakout",
                    "SOL": "donchian_trend", "DOGE": "trend_regime", "BNB": "macd_trend",
                    "ADA": "bb_breakout"},
    # same but BNB/BTC on the v9 engines too (maximum v9 share)
    "v9 bb+donchian": {"BTC": "bb_breakout", "ETH": "donchian_trend", "XRP": "bb_breakout",
                       "SOL": "donchian_trend", "DOGE": "bb_breakout",
                       "BNB": "donchian_trend", "ADA": "bb_breakout"},
    "v9 bb-core": {"BTC": "bb_breakout", "ETH": "tsmom", "XRP": "bb_breakout",
                   "SOL": "bb_breakout", "DOGE": "bb_breakout", "BNB": "donchian_trend",
                   "ADA": "bb_breakout"},
    "v9 max-new": {"BTC": "donchian_trend", "ETH": "tsmom", "XRP": "bb_breakout",
                   "SOL": "donchian_trend", "DOGE": "trend_regime", "BNB": "bb_breakout",
                   "ADA": "bb_breakout"},
}


def market(venue: str, coin: str) -> str:
    return f"I-{coin}_INR" if venue == "coindcx" else f"BN-{coin}_USDT"


def sleeves(venue: str, lineup: dict[str, str]) -> list[dict]:
    out = []
    for coin, tpl in lineup.items():
        exits, params = TPL[tpl]
        out.append(dict(name=f"{tpl}_{coin.lower()}", module=_MODULE.get(tpl, tpl),
                        market=market(venue, coin), params=dict(params), **exits))
    return out


def load_venue(venue: str):
    by_market = {market(venue, c): {b["time"]: b for b in load(
        os.path.join(DEEP, f"{market(venue, c)}_1d.csv.gz"))} for c in COINS}
    start = max(min(v) for v in by_market.values())  # common span: every coin listed
    days = sorted(d for d in set().union(*[set(v) for v in by_market.values()]) if d >= start)
    # the overlay reads BTC under the key portfolio_study hard-codes
    by_market["I-BTC_INR"] = by_market[market(venue, "BTC")]
    return days, by_market


def yearly_folds(days, by_market, warmup: int = 120, **kw) -> list[tuple[int, float]]:
    out = []
    years = sorted({datetime.fromtimestamp(d / 1000, tz=timezone.utc).year for d in days})
    for y in years:
        idx = [i for i, d in enumerate(days)
               if datetime.fromtimestamp(d / 1000, tz=timezone.utc).year == y]
        if len(idx) < 200 or idx[0] < warmup:
            continue  # partial year or no warm-up history
        seg = days[idx[0] - warmup: idx[-1] + 1]
        segm = {m: {d: b[d] for d in seg if d in b} for m, b in by_market.items()}
        # the warm-up only feeds indicators: the portfolio starts flat on Jan 1
        r = ps.simulate(seg, segm, score_from=days[idx[0]], **kw)
        out.append((y, r["return_pct"]))
    return out


def main() -> None:
    for venue in ("coindcx", "binance"):
        costs._cache = {**costs._DEFAULTS, **VENUES[venue]["costs"]}
        days, by_market = load_venue(venue)
        span = (datetime.fromtimestamp(days[0] / 1000, tz=timezone.utc).date(),
                datetime.fromtimestamp(days[-1] / 1000, tz=timezone.utc).date())
        print(f"\n=== {venue} | common span {span[0]} .. {span[1]} ({len(days)} days) | "
              "BTC overlay ON ===")
        print(f"{'lineup':20} {'net%':>8} {'CAGR%':>6} {'maxDD%':>7} {'trades':>6} "
              f"{'win%':>5} {'pf':>5} {'fees%':>6}  yearly")
        for name, lu in LINEUPS.items():
            ps.SLEEVES = sleeves(venue, lu)
            r = ps.simulate(days, by_market, capital=7000.0, btc_filter_mult=0.0)
            yrs = len(days) / 365.0
            cagr = ((1 + r["return_pct"] / 100) ** (1 / yrs) - 1) * 100
            folds = yearly_folds(days, by_market, capital=7000.0, btc_filter_mult=0.0)
            fs = " ".join(f"{y % 100:02d}:{v:+.0f}" for y, v in folds)
            print(f"{name:20} {r['return_pct']:>8} {cagr:>6.1f} {r['max_dd_pct']:>7} "
                  f"{r['trades']:>6} {r['win_rate']:>5} {r['pf']:>5} {r['fees_pct']:>6}  {fs}")


if __name__ == "__main__":
    main()
