"""Build a per-user config.yaml from desired state + tier entitlements.

The supervisor writes one of these per active user; the user's `python -m bot.engine`
subprocess loads it via CONFIG_PATH. Strategy params/exits are the PROVEN defaults from the
repo's config.yaml (don't re-tune here). A user only chooses template + market (+ params on
the Max tier). Tier trades/day -> risk.max_trades_per_day (the bot already enforces it).
"""
from __future__ import annotations

from pathlib import Path

import yaml

import entitlements  # flat import: run with platform/worker on sys.path (not as 'platform.*')

# Proven per-template defaults, lifted from config.yaml. {exits..., market, params}.
TEMPLATE_DEFAULTS: dict[str, dict] = {
    "ma_crossover": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.04, "take_profit_pct": 0.0, "chandelier_k": 3.0,
        "atr_period": 16, "max_hold_bars": 0,
        "params": {"fast": 32, "slow": 96, "atr_period": 16, "k_atr": 0.5,
                   "confirm_bars": 4, "regime_period": 192, "expected_move_pct": 0.05},
    },
    "rsi": {
        "market": "I-ETH_INR",
        "stop_loss_pct": 0.03, "take_profit_pct": 0.03, "chandelier_k": 0.0,
        "atr_period": 16, "max_hold_bars": 64,
        "params": {"period": 14, "oversold": 22, "regime_period": 192, "expected_move_pct": 0.05},
    },
    "momentum": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.04, "take_profit_pct": 0.0, "chandelier_k": 3.0,
        "atr_period": 16, "max_hold_bars": 0,
        "params": {"lookback": 32, "atr_period": 16, "vol_period": 32, "min_atr_frac": 0.005,
                   "vol_mult": 1.2, "buffer": 0.002, "max_chase": 0.02,
                   "regime_period": 96, "expected_move_pct": 0.03},
    },
    "vol_expansion": {
        "market": "I-XRP_INR",
        "stop_loss_pct": 0.025, "take_profit_pct": 0.0, "chandelier_k": 2.5,
        "atr_period": 16, "max_hold_bars": 0,
        "params": {"short_atr": 8, "long_atr": 32, "expansion_mult": 1.6,
                   "breakout_lookback": 24, "regime_period": 96, "expected_move_pct": 0.03},
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
    "squeeze_breakout": {
        "market": "I-DOGE_INR",
        "stop_loss_pct": 0.04, "take_profit_pct": 0.0, "chandelier_k": 3.0,
        "atr_period": 16, "max_hold_bars": 0,
        "params": {"bb_period": 20, "k_bb": 2.0, "k_kc": 1.5, "atr_period": 16, "lookback": 20,
                   "squeeze_lookback": 6, "vol_period": 32, "vol_mult": 1.2, "buffer": 0.002,
                   "max_chase": 0.02, "min_atr_frac": 0.005,
                   "regime_period": 96, "expected_move_pct": 0.03},
    },
    # EXPERIMENTAL: Hugging Face Chronos forecast (bot/strategies/hf_forecast.py).
    # Needs `pip install chronos-forecasting torch` on the runner; without them the
    # strategy logs once and HOLDs forever (never crashes the engine). Tight stop,
    # take-profit and time-stop because model edge is unproven on crypto.
    "hf_forecast": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.03, "take_profit_pct": 0.04, "chandelier_k": 0.0,
        "atr_period": 16, "max_hold_bars": 32,
        "params": {"model": "amazon/chronos-bolt-tiny", "context": 384, "horizon": 8,
                   "min_forecast_pct": 1.0, "regime_period": 192, "expected_move_pct": 0.04},
    },
    # User-built rule strategies (bot/strategies/custom.py). The rule JSON travels in the
    # row's params; exits come from the def's "exits" (clamped in _strategy_spec). These
    # baseline exits apply only when the def carries none.
    "custom": {
        "market": "I-BTC_INR",
        "stop_loss_pct": 0.03, "take_profit_pct": 0.05, "chandelier_k": 0.0,
        "atr_period": 14, "max_hold_bars": 0,
        "params": {},
    },
}


def _clamp(v, lo: float, hi: float, dflt: float) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return dflt
    return min(hi, max(lo, v))

_BASE = {
    "engine": {"poll_seconds": 180, "candle_interval": "15m", "candle_limit": 400},
    "starting_equity": 1000.0,   # DRY_RUN sim wallet; LIVE reads the real exchange balance
    "allocation_frac": 0.97,
    "quote_currency": "INR",
    "costs": {"fee_rate": 0.002, "gst_on_fee": 0.18, "tds_rate": 0.01,
              "slippage_bps": 5.0, "edge_margin_pct": 0.002},
    # daily_loss_frac 0.10: halt the day at -10% of equity. A 50% brake is not a
    # guardrail — nobody's "bad day" budget is half the account. Surfaced verbatim in
    # web/lib/risk.ts (keep in sync). max_trades_per_day is overwritten per tier.
    "risk": {"max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
             "daily_loss_frac": 0.10, "max_trades_per_day": 5},
}


def _strategy_spec(idx: int, s: dict) -> dict:
    """One desired-strategy row -> a config.yaml strategy block (defaults merged, params
    overridable only because entitlements already nulled params for non-custom tiers)."""
    tpl = s["template"]
    d = TEMPLATE_DEFAULTS[tpl]
    params = {**d["params"], **(s.get("params") or {})}
    spec = {
        "name": s.get("name") or f"{tpl}_{idx}",
        "module": tpl,
        "enabled": bool(s.get("enabled", True)),
        "weight": float(s.get("weight", 1.0)),
        "market": s.get("market") or d["market"],
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
        {"template": "ma_crossover", "market": "I-BTC_INR", "enabled": True},
        {"template": "rsi", "market": "I-ETH_INR", "enabled": True},
        {"template": "momentum", "market": "I-BTC_INR", "enabled": True},
        {"template": "fast_rsi", "market": "I-BNB_INR", "enabled": True},
    ]
    # pricing is off: every tier is fully unlocked (see entitlements.py).
    free = build_config("free", req, kill_switch_file="data/users/u1/KILL")
    assert free["risk"]["max_trades_per_day"] == 100
    assert free["risk"]["daily_loss_frac"] == 0.10, "daily loss brake must stay at 10%"
    assert sum(s["enabled"] for s in free["strategies"]) == 4, "free -> all active while pricing is off"

    mx = build_config("max", req, kill_switch_file="data/users/u2/KILL")
    assert mx["risk"]["max_trades_per_day"] == 100
    assert sum(s["enabled"] for s in mx["strategies"]) == 4, "max -> all active"
    assert yaml.safe_load(yaml.safe_dump(mx)) == mx, "round-trips through YAML"
    print("config_gen self-check OK")
