"""Golden-output parity check for the backtest's bounded decision window (see the
_decision_window_bars() comment in backtest.py).

`run()` used to hand every strategy the FULL history-so-far (`candles[:i+1]`), an O(n) copy
repeated every bar. It now hands a fixed-size trailing slice instead, sized generously above
each strategy's own `min_candles`. This asserts, bar-for-bar, over real historical data, that
every registered strategy's decide() returns IDENTICAL output whether given the full history
or the new bounded window - i.e. the bound never actually withholds a bar any strategy uses.

Run: python -m bot.test_decision_window
"""
import csv
import gzip
from pathlib import Path

from . import config
from .backtest import _decision_window_bars
from .strategies import REGISTRY

DATA = Path(__file__).resolve().parent.parent / "research" / "data" / "B-BTC_USDT_1h.csv.gz"

# One representative, non-trivial param set per template (mirrors strattice/worker/config_gen.py
# TEMPLATE_DEFAULTS so the test exercises the same shapes real users' bots run with), with a
# smaller regime_period so the uptrend/downtrend gate actually flips within the test window.
PARAM_SETS: dict[str, dict] = {
    "ma_crossover": {"fast": 20, "slow": 50, "atr_period": 14, "k_atr": 0.5,
                     "confirm_bars": 4, "regime_period": 80, "expected_move_pct": 0.01},
    "rsi": {"period": 14, "oversold": 30, "regime_period": 80, "expected_move_pct": 0.01},
    "momentum": {"lookback": 20, "atr_period": 14, "vol_period": 20,
                 "regime_period": 80, "expected_move_pct": 0.01},
    "vol_expansion": {"short_atr": 8, "long_atr": 32, "expansion_mult": 1.2,
                      "breakout_lookback": 16, "regime_period": 80, "expected_move_pct": 0.01},
    "fast_rsi": {"period": 7, "oversold": 35, "regime_period": 80, "expected_move_pct": 0.01},
    "bb_reversion": {"period": 20, "k": 2.0, "z_entry": 1.5,
                     "regime_period": 80, "expected_move_pct": 0.01},
    "squeeze_breakout": {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 16,
                        "lookback": 20, "squeeze_lookback": 6, "vol_period": 32,
                        "regime_period": 80, "expected_move_pct": 0.01},
    "tsmom": {"lookback": 30, "min_return": 0.02, "regime_period": 80, "expected_move_pct": 0.01},
    "supertrend": {"atr_period": 10, "mult": 3.0, "confirm_bars": 2,
                   "regime_period": 80, "expected_move_pct": 0.01},
    "trend_ensemble": {"lookbacks": [10, 20, 40, 80], "min_agree_frac": 0.8, "confirm_bars": 3,
                       "regime_period": 80, "expected_move_pct": 0.01},
    "acceleration": {"fast": 10, "min_return": 0.03, "accel_mult": 1.3, "breakout_lookback": 20,
                     "vol_period": 20, "vol_mult": 0.8, "regime_period": 80,
                     "expected_move_pct": 0.01},
    "capitulation": {"crash_lookback": 10, "crash_drop": 0.06, "max_drop": 0.50,
                     "rsi_period": 14, "oversold": 35, "vol_period": 20, "vol_mult": 1.0,
                     "expected_move_pct": 0.01},
    "trend_regime": {"period": 100, "band": 0.01, "slope_bars": 5, "expected_move_pct": 0.01},
    "kama_trend": {"er_period": 10, "fast": 2, "slow": 30, "entry_band": 0.005,
                   "exit_band": 0.005, "slope_bars": 3, "min_er": 0.2, "regime_period": 80,
                   "expected_move_pct": 0.01},
    "ichimoku": {"tenkan": 9, "kijun": 26, "senkou_b": 52, "confirm_bars": 3,
                 "expected_move_pct": 0.01},
    "adx_trend": {"period": 14, "min_adx": 18, "confirm_bars": 3, "regime_period": 80,
                  "expected_move_pct": 0.01},
    "sharpe_mom": {"lookback": 30, "min_score": 1.0, "min_return": 0.02,
                   "near_high_frac": 0.05, "regime_period": 80, "expected_move_pct": 0.01},
    "macd_trend": {"fast": 12, "slow": 26, "signal": 9, "confirm_bars": 3,
                   "require_positive": True, "regime_period": 80, "expected_move_pct": 0.01},
    "custom": {"rules": [
        {"kind": "trend", "op": "above", "period": 50},
        {"kind": "sma_cross", "fast": 10, "slow": 30, "within": 3},
        {"kind": "rsi", "period": 14, "op": "below", "value": 60},
        {"kind": "volume", "period": 20, "mult": 0.8},
        {"kind": "breakout", "lookback": 20, "buffer": 0.1},
        {"kind": "volatility", "period": 14, "op": "above", "value": 0.1},
        {"kind": "change", "lookback": 10, "op": "above", "value": -1.0},
        {"kind": "confirm"},
    ]},
    # hf_forecast needs optional heavy deps (chronos/torch); without them it always HOLDs
    # regardless of window, so its own decide() short-circuits before the window matters. It's
    # still included so this test fails loudly if those deps are ever added to requirements.txt
    # without re-verifying context-window parity.
    "hf_forecast": {"context": 384, "horizon": 8, "min_forecast_pct": 0.5, "regime_period": 80},
}


def _load_candles() -> list[dict]:
    with gzip.open(DATA, "rt", newline="") as f:
        rows = list(csv.DictReader(f))
    return [{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
             "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["volume"])}
            for r in rows]


def _check_strategy(name: str, cls, params: dict, candles: list[dict]) -> None:
    strat = cls("t", "M", params)
    bound = _decision_window_bars(strat)
    start = max(strat.min_candles, 2)
    mismatches = []
    seen = {"BUY": 0, "SELL": 0, "HOLD": 0}
    for i in range(start, len(candles)):
        full = candles[: i + 1]
        bounded = candles[max(0, i + 1 - bound): i + 1]
        d_full = strat.decide(full)
        d_bounded = strat.decide(bounded)
        seen[d_full] = seen.get(d_full, 0) + 1
        if d_full != d_bounded:
            mismatches.append((i, d_full, d_bounded))
            if len(mismatches) > 5:
                break
    assert not mismatches, f"{name}: bounded window diverged from full history at bars {mismatches}"
    print(f"  {name:18} OK  decisions={ {k: v for k, v in seen.items() if v} }  window_bars={bound}")


def main() -> None:
    candles = _load_candles()
    assert len(candles) > 2000, f"expected a multi-thousand-bar fixture, got {len(candles)}"
    print(f"loaded {len(candles)} real 1h BTC/USDT candles from {DATA.name}")
    for name, cls in REGISTRY.items():
        params = PARAM_SETS.get(name)
        assert params is not None, f"no test params for strategy {name!r} - add one to PARAM_SETS"
        _check_strategy(name, cls, params, candles)
    print("decision-window parity OK: bounded window is bar-for-bar identical to full history "
          "for every registered strategy")


if __name__ == "__main__":
    main()
