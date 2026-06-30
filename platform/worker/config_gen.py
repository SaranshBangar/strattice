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
}

_BASE = {
    "engine": {"poll_seconds": 180, "candle_interval": "15m", "candle_limit": 400},
    "starting_equity": 1000.0,   # DRY_RUN sim wallet; LIVE reads the real exchange balance
    "allocation_frac": 0.97,
    "quote_currency": "INR",
    "costs": {"fee_rate": 0.002, "gst_on_fee": 0.18, "tds_rate": 0.01,
              "slippage_bps": 5.0, "edge_margin_pct": 0.002},
    "risk": {"max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
             "daily_loss_frac": 0.5, "max_trades_per_day": 5},  # overwritten per tier
}


def _strategy_spec(idx: int, s: dict) -> dict:
    """One desired-strategy row -> a config.yaml strategy block (defaults merged, params
    overridable only because entitlements already nulled params for non-custom tiers)."""
    tpl = s["template"]
    d = TEMPLATE_DEFAULTS[tpl]
    params = {**d["params"], **(s.get("params") or {})}
    return {
        "name": s.get("name") or f"{tpl}_{idx}",
        "module": tpl,
        "enabled": bool(s.get("enabled", True)),
        "weight": float(s.get("weight", 1.0)),
        "market": s.get("market") or d["market"],
        "stop_loss_pct": d["stop_loss_pct"], "take_profit_pct": d["take_profit_pct"],
        "chandelier_k": d["chandelier_k"], "atr_period": d["atr_period"],
        "max_hold_bars": d["max_hold_bars"], "params": params,
    }


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


def write_config(path: Path, cfg: dict) -> bool:
    """Write YAML only if changed (engine re-reads each poll; avoid needless churn). True if written."""
    new = yaml.safe_dump(cfg, sort_keys=False)
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
    free = build_config("free", req, kill_switch_file="data/users/u1/KILL")
    assert free["risk"]["max_trades_per_day"] == 5
    assert sum(s["enabled"] for s in free["strategies"]) == 1, "free -> 1 active"
    assert all(s["module"] == "ma_crossover" for s in free["strategies"]), "free -> default only"

    mx = build_config("max", req, kill_switch_file="data/users/u2/KILL")
    assert mx["risk"]["max_trades_per_day"] == 100
    assert sum(s["enabled"] for s in mx["strategies"]) == 4, "max -> all active"
    assert yaml.safe_load(yaml.safe_dump(mx)) == mx, "round-trips through YAML"
    print("config_gen self-check OK")
