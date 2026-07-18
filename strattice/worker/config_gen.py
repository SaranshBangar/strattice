"""Build a per-user config.yaml from desired state + tier entitlements.

The supervisor writes one of these per active user; the user's `python -m bot.engine`
subprocess loads it via CONFIG_PATH. Strategy params/exits are the PROVEN defaults from the
repo's config.yaml (don't re-tune here). A user only chooses template + market (+ params on
the Max tier). Tier trades/day -> risk.max_trades_per_day (the bot already enforces it).
"""
from __future__ import annotations

from pathlib import Path

import yaml

import entitlements  # flat import: run with strattice/worker on sys.path (not as 'platform.*')

# Proven per-template defaults, lifted from config.yaml (the DAILY profile validated in
# research/FINDINGS.md — the engine trades 1d bars). {exits..., market, params}.
# Default markets are where each template was profitable on BOTH the INR pair and its
# USDT twin (venue robustness). Trend templates: no take-profit, 3.5×ATR(14) chandelier,
# 7% hard stop — the fat right tail of trend winners is what pays India's ~1.5-1.7%
# round-trip friction.
TEMPLATE_DEFAULTS: dict[str, dict] = {
    # +207.6% net (PF 2.58) on I-ETH_INR 2023-09..2026-07; 17/21 walk-forward folds.
    "tsmom": {
        "market": "I-ETH_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"lookback": 30, "min_return": 0.10, "near_high_frac": 0.02,
                   "regime_period": 50, "expected_move_pct": 0.08},
    },
    # +108.7% net (PF 2.75) on I-BTC_INR; 16/21 folds.
    "momentum": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"lookback": 20, "atr_period": 14, "vol_period": 20, "min_atr_frac": 0.01,
                   "vol_mult": 1.0, "buffer": 0.002, "max_chase": 0.05,
                   "regime_period": 50, "expected_move_pct": 0.08},
    },
    # +138.9% net (PF 2.85) on I-DOGE_INR; 18/21 folds — best fold record of the study.
    "squeeze_breakout": {
        "market": "I-DOGE_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 14, "lookback": 20,
                   "squeeze_lookback": 6, "vol_period": 20, "vol_mult": 1.0, "buffer": 0.002,
                   "max_chase": 0.05, "min_atr_frac": 0.01,
                   "regime_period": 50, "expected_move_pct": 0.08},
    },
    # +187.7% net (PF 2.25) on I-XRP_INR (twin +109.8%).
    "ma_crossover": {
        "market": "I-XRP_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"fast": 8, "slow": 25, "atr_period": 14, "k_atr": 0.2,
                   "confirm_bars": 3, "regime_period": 100, "expected_move_pct": 0.08},
    },
    # +143.6% net (PF 2.75) on I-BNB_INR (twin +171.9%); 78/81 param combos positive.
    "vol_expansion": {
        "market": "I-BNB_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"short_atr": 5, "long_atr": 20, "expansion_mult": 1.3,
                   "breakout_lookback": 10, "regime_period": 50, "expected_move_pct": 0.06},
    },
    # +94.6% net on I-BTC_INR (twin +21.8%); 7/7 INR pairs positive; 15/21 folds (v4).
    "supertrend": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"atr_period": 10, "mult": 3.0, "confirm_bars": 2,
                   "regime_period": 50, "expected_move_pct": 0.08},
    },
    # +264.9% net (PF 6.85) on I-BNB_INR (twin +188.8%); 8/8 walk-forward folds across
    # both venues — the best fold record of any study (v6).
    "macd_trend": {
        "market": "I-BNB_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"fast": 12, "slow": 26, "signal": 9, "confirm_bars": 3,
                   "require_positive": 1, "regime_period": 50, "expected_move_pct": 0.08},
    },
    # +209.8% net (PF 3.76) on I-DOGE_INR (twin +167.5%). Faber-style regime holder:
    # the strategy's own SELL (close under the line - band) is the exit — NO chandelier
    # (a trail would cut the multi-month holds), wider 10% disaster stop instead (v6).
    "trend_regime": {
        "market": "I-DOGE_INR",
        "stop_loss_pct": 0.10, "take_profit_pct": 0.0, "chandelier_k": 0.0,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"period": 100, "band": 0.02, "slope_bars": 5, "expected_move_pct": 0.10},
    },
    # +83.3% net (PF 1.87) on I-ADA_INR (twin +42.6%); tested parameter sets 6/6
    # positive on both venues. Own SELL below the kijun line — no chandelier (v6).
    "ichimoku": {
        "market": "I-ADA_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 0.0,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"tenkan": 9, "kijun": 26, "senkou_b": 52, "confirm_bars": 3,
                   "expected_move_pct": 0.08},
    },
    # +272.2% net on I-ETH_INR (twin +41.1%); 3/4+3/4 folds. Risk-adjusted (vol-scaled)
    # momentum — validated as a template; the ETH bot sleeve stays with tsmom (v6).
    "sharpe_mom": {
        "market": "I-ETH_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {"lookback": 30, "min_score": 1.5, "min_return": 0.06,
                   "near_high_frac": 0.03, "regime_period": 50, "expected_move_pct": 0.08},
    },
    # --- RETIRED templates (mean reversion loses net of India friction at every tested
    # altitude — research/FINDINGS.md). Kept ONLY so legacy rows keep resolving and any
    # open position keeps its exits managed. Not offered for new adds in the UI. ---
    "rsi": {
        "market": "I-ETH_INR",
        "stop_loss_pct": 0.03, "take_profit_pct": 0.03, "chandelier_k": 0.0,
        "atr_period": 16, "max_hold_bars": 64,
        "params": {"period": 14, "oversold": 22, "regime_period": 192, "expected_move_pct": 0.05},
    },
    "fast_rsi": {
        "market": "I-BNB_INR",
        "stop_loss_pct": 0.02, "take_profit_pct": 0.025, "chandelier_k": 0.0,
        "atr_period": 16, "max_hold_bars": 12,
        "params": {"period": 7, "oversold": 25, "regime_period": 96, "expected_move_pct": 0.03},
    },
    "bb_reversion": {
        "market": "I-SOL_INR",
        "stop_loss_pct": 0.03, "take_profit_pct": 0.04, "chandelier_k": 0.0,
        "atr_period": 16, "max_hold_bars": 32,
        "params": {"period": 20, "k": 2.0, "z_entry": 2.0,
                   "regime_period": 96, "expected_move_pct": 0.03},
    },
    # EXPERIMENTAL: Hugging Face Chronos-2 forecast (bot/strategies/hf_forecast.py).
    # Needs `pip install "chronos-forecasting>=2.0" torch` on the runner; without them
    # the strategy logs once and HOLDs forever (never crashes the engine). Exits are
    # horizon-matched (8-day forecast -> 16-day time-stop) because model edge is
    # unproven on crypto; the bot falls back to chronos-bolt-tiny if chronos-2 can't load.
    "hf_forecast": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.05, "take_profit_pct": 0.08, "chandelier_k": 0.0,
        "atr_period": 14, "max_hold_bars": 16,
        "params": {"model": "amazon/chronos-2", "context": 512, "horizon": 8,
                   "min_forecast_pct": 3.0, "regime_period": 100, "expected_move_pct": 0.06},
    },
    # User-built rule strategies (bot/strategies/custom.py). The rule JSON travels in the
    # row's params; exits come from the def's "exits" (clamped in _strategy_spec). These
    # baseline exits apply only when the def carries none — daily-bar friendly: 7% stop,
    # chandelier trail, no target.
    "custom": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.07, "take_profit_pct": 0.0, "chandelier_k": 3.5,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {},
    },
}


def _clamp(v, lo: float, hi: float, dflt: float) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return dflt
    if v != v:  # NaN never survives into a config
        return dflt
    return min(hi, max(lo, v))


# --- web -> worker boundary validation -------------------------------------------------
# Everything in a desired-strategy row (market, weight, name, params) is UNTRUSTED user
# data from the web DB. The web UI enforces the real per-param bounds; this layer is
# defense in depth so a tampered row can never emit a config that crash-loops an engine
# or smuggles junk types into strategy math.
_MARKET_RE = __import__("re").compile(r"^[BI]-[A-Z0-9]{1,15}_[A-Z0-9]{1,15}$")
_NAME_RE = __import__("re").compile(r"^[A-Za-z0-9_-]{1,48}$")
_STR_VALUE_RE = __import__("re").compile(r"^[A-Za-z0-9/_.:-]{1,100}$")
_MAX_CUSTOM_PARAMS_BYTES = 100_000  # a custom rule JSON larger than this is dropped


def _clean_params(tpl: str, user_params: dict | None) -> dict:
    """Merge user param overrides over the template defaults, treating the overrides as
    hostile: unknown keys are dropped (whitelist = the template's own default keys),
    values are coerced to the default's type and clamped to sane numeric ranges, and
    strings are length/charset-bounded. `custom` rule JSON passes through size-capped -
    bot/strategies/custom.py is its (defensive) interpreter."""
    defaults = TEMPLATE_DEFAULTS[tpl]["params"]
    if tpl == "custom":
        p = user_params if isinstance(user_params, dict) else {}
        import json as _json
        try:
            if len(_json.dumps(p)) > _MAX_CUSTOM_PARAMS_BYTES:
                return dict(defaults)
        except (TypeError, ValueError):
            return dict(defaults)
        return {**defaults, **p}
    out = dict(defaults)
    if not isinstance(user_params, dict):
        return out
    for k, dv in defaults.items():
        if k not in user_params:
            continue
        v = user_params[k]
        if isinstance(dv, bool) or (isinstance(dv, int) and dv in (0, 1) and
                                    k == "require_positive"):
            out[k] = 1 if v in (True, 1, "1", "true", "True") else 0 if v in (
                False, 0, "0", "false", "False") else dv
        elif isinstance(dv, int):
            out[k] = int(_clamp(v, 0, 10_000, dv))
        elif isinstance(dv, float):
            out[k] = float(_clamp(v, -100.0, 100.0, dv))
        elif isinstance(dv, str):
            out[k] = v if isinstance(v, str) and _STR_VALUE_RE.match(v) else dv
        # any other default type (lists etc.): keep the default, drop the override
    return out

_BASE = {
    # DAILY bars (was 15m): the only altitude that survived the friction study
    # (research/FINDINGS.md). 5-min poll acts within minutes of each daily close;
    # 400 daily bars ≈ 13 months > regime(100) + slow MA + ATR warmups.
    # crash_brake stays FALSE: the v7 study measured intraday hard-stops at -107pts
    # net / +5pts max-DD (whipsaw), and it diverges from the close-based backtest.
    "engine": {"poll_seconds": 300, "candle_interval": "1d", "candle_limit": 400,
               "crash_brake": False},
    # BTC 100d trend overlay, PROMOTED default-ON in v7: blocks NEW entries while BTC
    # is under its 100d SMA. Better net/PF/worst-fold on BOTH venues (FINDINGS v7).
    # Fails open on a bad BTC feed; never touches exits.
    "portfolio": {"btc_regime_filter": {"enabled": True, "market": "I-BTC_INR",
                                        "period": 100, "entry_mult": 0.0}},
    "starting_equity": 1000.0,   # DRY_RUN sim wallet; LIVE reads the real exchange balance
    "allocation_frac": 0.97,
    "quote_currency": "INR",
    "costs": {"fee_rate": 0.002, "gst_on_fee": 0.18, "tds_rate": 0.01,
              "slippage_bps": 5.0, "edge_margin_pct": 0.002},
    # daily_loss_frac 0.10: halt the day at -10% of equity. A 50% brake is not a
    # guardrail — nobody's "bad day" budget is half the account. Surfaced verbatim in
    # web/lib/risk.ts (keep in sync). max_trades_per_day is overwritten per tier.
    # v7 risk knobs ship at their validated defaults (all off - FINDINGS v7).
    "risk": {"max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
             "daily_loss_frac": 0.10, "max_trades_per_day": 5,
             "max_new_entries_per_day": 0, "max_consecutive_losses_halt": 0,
             "sleeve_drawdown_derisk_frac": 0.0, "sleeve_drawdown_derisk_mult": 0.5},
}


def _strategy_spec(idx: int, s: dict) -> dict:
    """One desired-strategy row -> a config.yaml strategy block (defaults merged, params
    overridable only because entitlements already nulled params for non-custom tiers)."""
    tpl = s["template"]
    d = TEMPLATE_DEFAULTS[tpl]
    params = _clean_params(tpl, s.get("params"))
    name = s.get("name")
    if not (isinstance(name, str) and _NAME_RE.match(name)):
        name = f"{tpl}_{idx}"
    market = s.get("market")
    if not (isinstance(market, str) and _MARKET_RE.match(market)):
        market = d["market"]  # malformed/non-spot market id -> template's proven default
    spec = {
        "name": name,
        "module": tpl,
        "enabled": bool(s.get("enabled", True)),
        "weight": _clamp(s.get("weight", 1.0), 0.0, 10.0, 1.0),
        "market": market,
        "stop_loss_pct": d["stop_loss_pct"], "take_profit_pct": d["take_profit_pct"],
        "chandelier_k": d["chandelier_k"], "atr_period": d["atr_period"],
        "max_hold_bars": d["max_hold_bars"], "params": params,
    }
    if tpl == "custom":
        # user-built strategy: exits come from the def, clamped to the same bounds the web
        # sanitizer enforces (defense in depth - never trust stored JSON). A def without
        # rules simply never fires (custom.py HOLDs), so the row stays harmless.
        e = params.get("exits") or {}
        spec["stop_loss_pct"] = _clamp(e.get("stop_loss_pct"), 0.005, 0.2, d["stop_loss_pct"])
        spec["take_profit_pct"] = _clamp(e.get("take_profit_pct"), 0.0, 0.5, d["take_profit_pct"])
        spec["chandelier_k"] = _clamp(e.get("chandelier_k"), 0.0, 6.0, d["chandelier_k"])
        spec["atr_period"] = int(_clamp(e.get("atr_period"), 2, 50, d["atr_period"]))
        spec["max_hold_bars"] = int(_clamp(e.get("max_hold_bars"), 0, 500, d["max_hold_bars"]))
        if isinstance(params.get("name"), str) and params["name"].strip():
            spec["name"] = f"custom_{idx}"  # engine name stays machine-safe; display name lives in the def
    return spec


def build_config(tier: str, requested: list[dict], *, kill_switch_file: str) -> dict:
    """Full config dict for a user. Applies tier caps via entitlements, sets trades/day."""
    t = entitlements.resolve(tier)
    allowed = entitlements.allowed_strategies(tier, requested)
    cfg = {k: (v.copy() if isinstance(v, dict) else v) for k, v in _BASE.items()}
    cfg["risk"] = {**_BASE["risk"], "max_trades_per_day": t.trades_per_day,
                   "kill_switch_file": kill_switch_file}
    cfg["strategies"] = [_strategy_spec(i, s) for i, s in enumerate(allowed)] or [
        # never emit an empty strategies list (engine would idle but log oddly): give the default off.
        _strategy_spec(0, {"template": entitlements.DEFAULT_TEMPLATE, "enabled": False})
    ]
    return cfg


def write_config(path: Path, cfg: dict, dumped: str | None = None) -> bool:
    """Write YAML only if changed (engine re-reads each poll; avoid needless churn). True if written.
    Pass `dumped` when the caller already has yaml.safe_dump(cfg, sort_keys=False) (e.g. because
    it also needs it for a change-hash) to avoid dumping the same config twice."""
    new = dumped if dumped is not None else yaml.safe_dump(cfg, sort_keys=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == new:
        return False
    path.write_text(new, encoding="utf-8")
    return True


if __name__ == "__main__":
    # self-check: tier cap reaches the generated config; entitlements applied; valid YAML.
    req = [
        {"template": "tsmom", "market": "I-ETH_INR", "enabled": True},
        {"template": "momentum", "market": "I-BTC_INR", "enabled": True},
        {"template": "supertrend", "market": "I-BTC_INR", "enabled": True},
        {"template": "rsi", "market": "I-ETH_INR", "enabled": True},  # retired legacy row
    ]
    # pricing is off: every tier is fully unlocked (see entitlements.py).
    free = build_config("free", req, kill_switch_file="data/users/u1/KILL")
    assert free["risk"]["max_trades_per_day"] == 100
    assert free["risk"]["daily_loss_frac"] == 0.10, "daily loss brake must stay at 10%"
    assert free["engine"]["candle_interval"] == "1d", "the engine trades DAILY bars"
    assert free["engine"]["crash_brake"] is False, "intraday brake stays off (v7 evidence)"
    assert free["portfolio"]["btc_regime_filter"]["enabled"] is True, "v7 BTC overlay ships on"
    assert free["risk"]["max_consecutive_losses_halt"] == 0, "tripwire ships off"
    assert sum(s["enabled"] for s in free["strategies"]) == 4, "free -> all active while pricing is off"
    assert free["strategies"][3]["module"] == "rsi", "legacy retired rows must still resolve"

    mx = build_config("max", req, kill_switch_file="data/users/u2/KILL")
    assert mx["risk"]["max_trades_per_day"] == 100
    assert sum(s["enabled"] for s in mx["strategies"]) == 4, "max -> all active"
    assert yaml.safe_load(yaml.safe_dump(mx)) == mx, "round-trips through YAML"
    # every template default must reference a module in the bot's registry, with a
    # daily-safe exit layer for the active trend templates.
    for tpl, d in TEMPLATE_DEFAULTS.items():
        spec = _strategy_spec(0, {"template": tpl})
        assert spec["module"] == tpl and spec["params"] is not None

    # web->worker boundary: hostile rows must come out clamped/defaulted, never verbatim.
    hostile = _strategy_spec(0, {
        "template": "tsmom",
        "market": "I-BTC_INR; DROP TABLE users",   # malformed -> template default market
        "name": "../../etc/passwd",                # unsafe name -> generated name
        "weight": "1e308",                         # absurd -> clamped
        "params": {"lookback": 10**9, "min_return": float("nan"), "evil_key": "x",
                   "regime_period": -5, "expected_move_pct": "0.08"},
    })
    assert hostile["market"] == "I-ETH_INR", hostile["market"]
    assert hostile["name"] == "tsmom_0", hostile["name"]
    assert hostile["weight"] == 10.0, hostile["weight"]
    p = hostile["params"]
    assert "evil_key" not in p, "unknown params must be dropped"
    assert p["lookback"] == 10_000 and p["regime_period"] == 0, p
    assert p["min_return"] == 0.10, "NaN must fall back to the default"
    assert p["expected_move_pct"] == 0.08, "numeric strings coerce"
    # oversized custom rule JSON is replaced by defaults, small ones pass through
    big = _strategy_spec(0, {"template": "custom", "params": {"rules": ["x" * 200_000]}})
    assert big["params"] == TEMPLATE_DEFAULTS["custom"]["params"], "oversized custom JSON dropped"
    ok_rules = {"rules": [{"kind": "confirm"}], "exits": {"stop_loss_pct": 0.5}}
    small = _strategy_spec(0, {"template": "custom", "params": ok_rules})
    assert small["params"]["rules"] == ok_rules["rules"]
    assert small["stop_loss_pct"] == 0.2, "custom exits stay clamped to the sanitizer bounds"
    print("config_gen self-check OK (incl. web->worker boundary hardening)")
