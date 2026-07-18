"""v8 study: "profit regardless of direction" claims, measured on real data.

Three families the ask covers, each replayed against the same CSV history and the
same cost models the bot uses (spot = bot/costs.py; derivatives = bot.backtest
FUTURES_COSTS — 0.075% taker + GST, no TDS, 0.03%/day funding drag):

1. --study neutral  Grid bots and martingale/DCA bots — the strategies most
   "always profitable" marketing describes. Both are SHORT-VOLATILITY inventory
   systems: they bank many small wins while price chops inside a range and hand
   the accumulated edge back (and more) when price trends out of it. The study
   measures exactly that: full-history nets plus a per-window distribution
   (non-overlapping 1000-bar windows) with each window's drift, so the
   chop-profit/trend-loss mechanics are visible instead of asserted.

2. --study ls       Symmetric long/short trend (donchian_ls, ensemble_ls — the
   true form of the v4-rejected trend_ensemble edge), long-only vs long/short,
   spot vs derivatives friction, plus 200-bar walk-forward folds.

3. --study tight    "Extremely tight SL/TP" sweeps (SL 0.5-2%, TP 1-4%) against
   the lineup's wide-stop baseline, on both venues' friction. A stop-out costs a
   full round trip, so the arithmetic floor is round_trip_cost / SL distance.

Usage:
  python -m research.ls_study --study all
  python -m research.ls_study --study neutral --json out.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot import costs                                      # noqa: E402
from bot.backtest import FUTURES_COSTS, run, walk_forward  # noqa: E402
from bot.strategies import REGISTRY                        # noqa: E402
from research.run_backtests import available, load_csv     # noqa: E402

DERIV = dict(FUTURES_COSTS)


def _fee(profile: dict | None, notional: float) -> float:
    if profile is None:
        return costs.trading_fee(notional)
    return profile["fee_rate"] * notional * (1 + profile.get("gst_on_fee", 0.18))


def _tds(profile: dict | None, notional: float) -> float:
    if profile is None:
        return costs.tds("sell", notional)
    return profile.get("tds_rate", 0.0) * notional


# ---------------------------------------------------------------- grid simulator
def grid_sim(candles: list[dict], capital: float, range_frac: float = 0.15,
             levels: int = 20, profile: dict | None = None) -> dict:
    """Classic symmetric spot grid: `levels` buy lines spanning +/-range_frac around
    the starting price; each buy at line k pairs with a sell one line up. Lines above
    the start are seeded as inventory bought at the start price (the standard 50/50
    grid bootstrap). Fills use bar low/high (grids trade intrabar by design; a
    close-only replay would barely trade). Mark-to-market applies exit costs."""
    p0 = candles[0]["close"]
    lo, hi = p0 * (1 - range_frac), p0 * (1 + range_frac)
    step = (hi - lo) / levels
    lines = [lo + k * step for k in range(levels + 1)]
    per_slot = capital / levels
    held: dict[int, float] = {}                 # buy-line index -> qty held
    cash = capital
    fees = 0.0
    cycles = 0
    equity_curve = []

    # seed inventory for slots whose buy line is above the market
    for k in range(levels):
        if lines[k] >= p0:
            qty = per_slot / p0
            fee = _fee(profile, per_slot)
            cash -= per_slot + fee
            fees += fee
            held[k] = qty

    for c in candles:
        # buys on the way down: any empty slot whose line the bar low reached
        for k in range(levels - 1, -1, -1):
            if k not in held and c["low"] <= lines[k] \
                    and cash >= per_slot + _fee(profile, per_slot):
                qty = per_slot / lines[k]
                fee = _fee(profile, per_slot)
                cash -= per_slot + fee
                fees += fee
                held[k] = qty
        # sells on the way up: any held slot whose paired line the bar high reached
        for k in sorted(held):
            sell_px = lines[k + 1]
            if c["high"] >= sell_px:
                notional = held[k] * sell_px
                fee = _fee(profile, notional) + _tds(profile, notional)
                cash += notional - fee
                fees += fee
                del held[k]
                cycles += 1
        equity_curve.append(cash + sum(q for q in held.values()) * c["close"])

    last = candles[-1]["close"]
    inv_notional = sum(q for q in held.values()) * last
    exit_cost = _fee(profile, inv_notional) + _tds(profile, inv_notional)
    final = cash + inv_notional - exit_cost
    peak, max_dd = equity_curve[0] if equity_curve else capital, 0.0
    for e in equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak if peak else 0.0)
    return {"return_pct": round((final - capital) / capital * 100, 2),
            "cycles": cycles, "fees_pct": round(fees / capital * 100, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "ended_below_grid": candles[-1]["close"] < lo,
            "ended_above_grid": candles[-1]["close"] > hi}


# ---------------------------------------------------- martingale/DCA simulator
def martingale_sim(candles: list[dict], capital: float, base_frac: float = 0.02,
                   so_count: int = 7, so_step: float = 0.025, step_scale: float = 1.4,
                   vol_scale: float = 1.5, tp: float = 0.015,
                   profile: dict | None = None) -> dict:
    """3Commas-style long DCA/martingale deal cycle: base order, then up to so_count
    safety orders at geometrically widening deviations with geometrically growing
    size, take-profit on the volume-weighted average price. A new deal opens on the
    bar after a take-profit. This is the honest shape of most "profits in any
    market" bots: high win rate, small wins, occasional deep held drawdown."""
    cash = capital
    fees = 0.0
    deals = 0
    qty = avg = spent = 0.0
    so_filled = 0
    entry = 0.0
    equity_curve = []
    worst_open_frac = 0.0

    def so_price(n: int) -> float:          # cumulative deviation of safety order n (1-based)
        cum = so_step * (step_scale ** n - 1) / (step_scale - 1)
        return entry * (1 - cum)

    def so_size(n: int) -> float:
        return capital * base_frac * (vol_scale ** n)

    for c in candles:
        px = c["close"]
        if qty == 0.0:
            entry = px
            size = min(capital * base_frac, cash)
            fee = _fee(profile, size)
            if size <= 0 or cash < size + fee:
                equity_curve.append(cash)
                continue
            qty = size / px
            spent = size + fee
            fees += fee
            cash -= size + fee
            avg = px
            so_filled = 0
        else:
            # safety orders fill on the bar low, deepest reachable first
            while so_filled < so_count:
                trigger = so_price(so_filled + 1)
                size = so_size(so_filled + 1)
                fee = _fee(profile, size)
                if c["low"] <= trigger and cash >= size + fee:
                    qty += size / trigger
                    spent += size + fee
                    fees += fee
                    cash -= size + fee
                    avg = spent / qty
                    so_filled += 1
                else:
                    break
            target = avg * (1 + tp)
            if c["high"] >= target:
                notional = qty * target
                fee = _fee(profile, notional) + _tds(profile, notional)
                cash += notional - fee
                fees += fee
                qty = spent = avg = 0.0
                deals += 1
        mark = cash + qty * px
        if qty > 0 and spent > 0:
            worst_open_frac = max(worst_open_frac, max(0.0, (spent - qty * px) / capital))
        equity_curve.append(mark)

    last = candles[-1]["close"]
    inv = qty * last
    final = cash + (inv - _fee(profile, inv) - _tds(profile, inv) if qty > 0 else 0.0)
    peak, max_dd = equity_curve[0] if equity_curve else capital, 0.0
    for e in equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak if peak else 0.0)
    return {"return_pct": round((final - capital) / capital * 100, 2),
            "deals": deals, "fees_pct": round(fees / capital * 100, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "worst_open_loss_pct_of_capital": round(worst_open_frac * 100, 2),
            "stuck_open_at_end": qty > 0}


# ------------------------------------------------------------------ study: neutral
def study_neutral(out: list[dict], capital: float) -> None:
    avail = available()
    print("\n=== NEUTRAL-CLAIM STUDY: grid + martingale, spot vs derivatives friction ===")
    hdr = (f"{'sim':11} {'pair':13} {'venue':6} {'window':>14} {'drift%':>8} {'net%':>8} "
           f"{'cyc/deal':>8} {'fees%':>7} {'dd%':>7} {'note':14}")
    print(hdr)
    print("-" * len(hdr))
    daily = sorted(p for (p, iv) in avail if iv == "1d" and p.startswith("I-"))
    for pair in daily:
        candles = load_csv(avail[(pair, "1d")])
        drift = (candles[-1]["close"] / candles[0]["close"] - 1) * 100
        for venue, profile in (("spot", None), ("deriv", DERIV)):
            g = grid_sim(candles, capital, profile=profile)
            note = "EXIT-DOWN" if g["ended_below_grid"] else \
                   "EXIT-UP" if g["ended_above_grid"] else "in-range"
            print(f"{'grid':11} {pair:13} {venue:6} {'full-hist':>14} {drift:>8.1f} "
                  f"{g['return_pct']:>8.2f} {g['cycles']:>8} {g['fees_pct']:>7.2f} "
                  f"{g['max_drawdown_pct']:>7.2f} {note:14}")
            out.append({"sim": "grid", "pair": pair, "venue": venue,
                        "window": "full", "drift_pct": round(drift, 1), **g})
            m = martingale_sim(candles, capital, profile=profile)
            note = "STUCK-OPEN" if m["stuck_open_at_end"] else ""
            print(f"{'martingale':11} {pair:13} {venue:6} {'full-hist':>14} {drift:>8.1f} "
                  f"{m['return_pct']:>8.2f} {m['deals']:>8} {m['fees_pct']:>7.2f} "
                  f"{m['max_drawdown_pct']:>7.2f} {note:14}")
            out.append({"sim": "martingale", "pair": pair, "venue": venue,
                        "window": "full", "drift_pct": round(drift, 1), **m})

    # per-window distribution on the deep 1h USDT archives: does "any market" hold?
    print("\n--- 1000-bar (~6wk) window distribution, 1h bars, derivatives friction ---")
    hdr = (f"{'sim':11} {'pair':13} {'win+':>5} {'wins':>5} {'mean%':>7} {'worst%':>8} "
           f"{'worst-window drift%':>20}")
    print(hdr)
    print("-" * len(hdr))
    hourly = sorted(p for (p, iv) in avail if iv == "1h" and p.startswith("B-"))
    for pair in hourly:
        candles = load_csv(avail[(pair, "1h")])
        wins = [candles[i:i + 1000] for i in range(0, len(candles) - 999, 1000)]
        for sim_name, fn in (("grid", grid_sim), ("martingale", martingale_sim)):
            rows = []
            for w in wins:
                r = fn(w, capital, profile=DERIV)
                rows.append((r["return_pct"], (w[-1]["close"] / w[0]["close"] - 1) * 100))
            pos = sum(1 for r, _d in rows if r > 0)
            worst = min(rows, key=lambda t: t[0])
            mean = sum(r for r, _d in rows) / len(rows)
            print(f"{sim_name:11} {pair:13} {pos:>5} {len(rows):>5} {mean:>7.2f} "
                  f"{worst[0]:>8.2f} {worst[1]:>20.1f}")
            out.append({"sim": sim_name + "_windows", "pair": pair, "venue": "deriv",
                        "windows": len(rows), "windows_positive": pos,
                        "mean_pct": round(mean, 2), "worst_pct": worst[0],
                        "worst_window_drift_pct": round(worst[1], 1)})


# ---------------------------------------------------------------------- study: ls
_LS_CANDIDATES = [
    ("donch20_ls", "donchian_ls", {"lookback": 20, "buffer": 0.002, "expected_move_pct": 0.08},
     dict(stop_loss_pct=0.07, chandelier_k=3.5, atr_period=14)),
    ("donch55_ls", "donchian_ls", {"lookback": 55, "buffer": 0.002, "expected_move_pct": 0.08},
     dict(stop_loss_pct=0.07, chandelier_k=3.5, atr_period=14)),
    ("ensemble_ls", "ensemble_ls", {"lookbacks": [10, 20, 40, 80, 160], "enter_frac": 0.8,
                                    "exit_frac": 0.5, "confirm_bars": 3, "expected_move_pct": 0.08},
     dict(stop_loss_pct=0.10)),
]


def study_ls(out: list[dict], capital: float, wf: bool) -> None:
    avail = available()
    print("\n=== LONG/SHORT TREND STUDY: 1d, long-only vs long/short, spot vs derivatives ===")
    hdr = (f"{'candidate':12} {'pair':13} {'mode':10} {'venue':6} {'trades':>6} {'net%':>8} "
           f"{'pf':>6} {'win%':>6} {'dd%':>7} {'fees%':>7} {'expo%':>6}")
    print(hdr)
    print("-" * len(hdr))
    pairs = sorted(p for (p, iv) in avail if iv == "1d")
    for name, module, params, exits in _LS_CANDIDATES:
        for pair in pairs:
            candles = load_csv(avail[(pair, "1d")])
            for mode, venue, allow, profile in (
                    ("long-only", "spot", False, None),
                    ("long/short", "spot", True, None),
                    ("long/short", "deriv", True, DERIV)):
                strat = REGISTRY[module](name, pair, params)
                if len(candles) < strat.min_candles + 50:
                    continue
                r = run(strat, candles, capital, interval="1d", allow_short=allow,
                        cost_profile=profile, **exits)
                print(f"{name:12} {pair:13} {mode:10} {venue:6} {r['trades']:>6} "
                      f"{r['return_pct']:>8.2f} {r['profit_factor']:>6} {r['win_rate']:>6.1f} "
                      f"{r['max_drawdown_pct']:>7.2f} {r['fees_pct_of_capital']:>7.2f} "
                      f"{r['exposure_pct']:>6.1f}")
                out.append({"candidate": name, "pair": pair, "mode": mode,
                            "venue": venue, **r})
            if wf:
                strat = REGISTRY[module](name, pair, params)
                walk_forward(strat, candles, capital, train=strat.min_candles + 50,
                             test=200, interval="1d", allow_short=True,
                             cost_profile=DERIV, **exits)


# ------------------------------------------------------------------- study: tight
def study_tight(out: list[dict], capital: float) -> None:
    avail = available()
    print("\n=== TIGHT SL/TP STUDY: the arithmetic of small stops under real friction ===")
    rt_spot = costs.round_trip_cost_pct() + costs.params()["tds_rate"]
    rt_der = 2 * DERIV["fee_rate"] * (1 + DERIV["gst_on_fee"])
    print(f"round-trip friction: spot ~{rt_spot * 100:.2f}% of notional, "
          f"derivatives ~{rt_der * 100:.2f}% (+funding 0.03%/day)")
    print("a 1% stop therefore loses ~1% + friction every time it fires; "
          "the win side must clear the same toll.\n")
    hdr = (f"{'pair':13} {'iv':3} {'venue':6} {'sl%':>5} {'tp%':>5} {'trades':>6} {'net%':>8} "
           f"{'pf':>6} {'win%':>6} {'fees%':>8} {'dd%':>7}")
    print(hdr)
    print("-" * len(hdr))
    # NOTE: expected_move_pct=1.0 BYPASSES the pre-trade friction gate. With an honest
    # value (== the TP distance) the gate refuses every tight-TP config on spot outright
    # (a 1-2% target cannot clear ~1.7% friction), i.e. the platform already blocks this
    # by construction — the bypass exists to MEASURE the loss the gate prevents.
    params = {"lookback": 20, "buffer": 0.002, "expected_move_pct": 1.0}
    combos = [(0.005, 0.01), (0.01, 0.02), (0.02, 0.04)]
    daily = sorted(p for (p, iv) in avail if iv == "1d" and p.startswith("I-"))
    for pair in daily:
        candles = load_csv(avail[(pair, "1d")])
        for venue, profile in (("spot", None), ("deriv", DERIV)):
            for sl, tp in combos:
                strat = REGISTRY["donchian_ls"]("tight", pair, params)
                r = run(strat, candles, capital, interval="1d", allow_short=True,
                        cost_profile=profile, stop_loss_pct=sl, take_profit_pct=tp)
                print(f"{pair:13} {'1d':3} {venue:6} {sl * 100:>5.1f} {tp * 100:>5.1f} "
                      f"{r['trades']:>6} {r['return_pct']:>8.2f} {r['profit_factor']:>6} "
                      f"{r['win_rate']:>6.1f} {r['fees_pct_of_capital']:>8.2f} "
                      f"{r['max_drawdown_pct']:>7.2f}")
                out.append({"study": "tight", "pair": pair, "interval": "1d",
                            "venue": venue, "sl": sl, "tp": tp, **r})
        # wide-stop baseline for contrast (the validated exit style), derivatives venue
        strat = REGISTRY["donchian_ls"]("wide", pair, params)
        r = run(strat, candles, capital, interval="1d", allow_short=True,
                cost_profile=DERIV, stop_loss_pct=0.07, chandelier_k=3.5, atr_period=14)
        print(f"{pair:13} {'1d':3} {'deriv':6} {'7.0':>5} {'trail':>5} {r['trades']:>6} "
              f"{r['return_pct']:>8.2f} {r['profit_factor']:>6} {r['win_rate']:>6.1f} "
              f"{r['fees_pct_of_capital']:>8.2f} {r['max_drawdown_pct']:>7.2f}")
        out.append({"study": "tight-baseline", "pair": pair, "interval": "1d",
                    "venue": "deriv", "sl": 0.07, "tp": 0.0, **r})

    # intraday expression: tight stops "belong" at 1h — measure them there too
    print("\n--- 1h expression (donchian_ls lookback=48), derivatives friction ---")
    for pair in ("B-BTC_USDT", "B-ETH_USDT", "B-SOL_USDT"):
        if (pair, "1h") not in avail:
            continue
        candles = load_csv(avail[(pair, "1h")])
        for sl, tp in combos:
            strat = REGISTRY["donchian_ls"]("tight1h", pair,
                                            {"lookback": 48, "buffer": 0.002,
                                             "expected_move_pct": 1.0})
            r = run(strat, candles, capital, interval="1h", allow_short=True,
                    cost_profile=DERIV, stop_loss_pct=sl, take_profit_pct=tp)
            print(f"{pair:13} {'1h':3} {'deriv':6} {sl * 100:>5.1f} {tp * 100:>5.1f} "
                  f"{r['trades']:>6} {r['return_pct']:>8.2f} {r['profit_factor']:>6} "
                  f"{r['win_rate']:>6.1f} {r['fees_pct_of_capital']:>8.2f} "
                  f"{r['max_drawdown_pct']:>7.2f}")
            out.append({"study": "tight", "pair": pair, "interval": "1h",
                        "venue": "deriv", "sl": sl, "tp": tp, **r})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--study", default="all", choices=["all", "neutral", "ls", "tight"])
    ap.add_argument("--capital", type=float, default=1000.0)
    ap.add_argument("--walkforward", action="store_true")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    if not available():
        print("no data in research/data; run the fetch-market-data workflow first")
        return
    out: list[dict] = []
    if a.study in ("all", "neutral"):
        study_neutral(out, a.capital)
    if a.study in ("all", "ls"):
        study_ls(out, a.capital, a.walkforward)
    if a.study in ("all", "tight"):
        study_tight(out, a.capital)
    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=1)
        print(f"\nwrote {len(out)} rows to {a.json}")


if __name__ == "__main__":
    main()
