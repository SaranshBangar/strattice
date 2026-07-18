"""Tier -> entitlements. Single source of truth for what each subscription tier unlocks.

Mirrors strattice/RESEARCH.md §3. The Next.js app MUST agree with this table; keep them in
sync (or have Next.js read it). Enforced here in the supervisor as the last line of defense:
even if the UI lets a user enable a forbidden strategy, resolve() + config_gen drop it.

PRICING IS DISABLED FOR NOW: the platform is fully free. Every tier resolves to the same
fully-unlocked entitlements; the paid tier names are kept only so legacy subscription rows
still resolve. The allowlist/cap machinery stays in place for when pricing returns.
"""
from __future__ import annotations

from dataclasses import dataclass

# Strategy templates we offer = the bot's REGISTRY (bot/strategies/__init__.py).
# "custom" is the user-built rule strategy: the rule JSON travels in the row's params
# and is interpreted by bot/strategies/custom.py.
# ACTIVE = the daily trend engines validated in research/FINDINGS.md; RETIRED = mean
# reversion (loses net of India friction at every altitude) — kept in the allowlist so
# LEGACY rows still resolve and open positions keep their exits managed, but the web UI
# no longer offers them for new adds (see web/lib/entitlements.ts RETIRED_TEMPLATES).
ACTIVE_TEMPLATES = (
    "tsmom", "momentum", "macd_trend", "trend_regime", "ichimoku", "sharpe_mom",
    "squeeze_breakout", "ma_crossover", "vol_expansion",
    "supertrend", "hf_forecast", "custom",
)
RETIRED_TEMPLATES = ("rsi", "fast_rsi", "bb_reversion")
ALL_TEMPLATES = ACTIVE_TEMPLATES + RETIRED_TEMPLATES
DEFAULT_TEMPLATE = "tsmom"  # the starting template new users see first


@dataclass(frozen=True)
class Tier:
    name: str
    price_inr: int
    trades_per_day: int
    max_active: int | None      # None = unlimited (all templates)
    allowed: frozenset[str]     # which templates this tier may run
    custom: bool                # may build custom (parameterized) strategies
    dashboard: str              # "basic" | "full"


_ALL = frozenset(ALL_TEMPLATES)

# Everything free while pricing is off: all templates, no active cap, full dashboard.
TIERS: dict[str, Tier] = {
    "free":    Tier("free",    0, 100, None, _ALL, True, "full"),
    "starter": Tier("starter", 0, 100, None, _ALL, True, "full"),
    "plus":    Tier("plus",    0, 100, None, _ALL, True, "full"),
    "pro":     Tier("pro",     0, 100, None, _ALL, True, "full"),
    "max":     Tier("max",     0, 100, None, _ALL, True, "full"),
}


def resolve(tier: str) -> Tier:
    """Unknown/expired tier -> free. (Caller decides expiry; this only maps the name.)"""
    return TIERS.get((tier or "").lower(), TIERS["free"])


def allowed_strategies(tier: str, requested: list[dict]) -> list[dict]:
    """Filter+cap a user's requested strategies to what their tier permits.

    requested: [{template, market, params, enabled, ...}, ...] (desired state from the DB).
    Drops templates not in the tier's allowlist, then trims the ENABLED set to max_active
    (highest-priority = original order). Disabled rows are kept (exits still managed) but never
    counted against the cap. Custom (non-stock-param) strategies require tier.custom.
    """
    t = resolve(tier)
    out = [s for s in requested if s.get("template") in t.allowed]
    if not t.custom:
        # strip any param overrides for non-custom tiers -> they run stock template params only
        out = [{**s, "params": None} if s.get("params") else s for s in out]
    if t.max_active is not None:
        kept, n = [], 0
        for s in out:
            if s.get("enabled", True):
                if n >= t.max_active:
                    s = {**s, "enabled": False}  # over cap -> force off
                else:
                    n += 1
            kept.append(s)
        out = kept
    return out


if __name__ == "__main__":
    # self-check: everything is unlocked while pricing is off, and the cap machinery
    # still filters unknown templates.
    free = resolve("free")
    assert free.trades_per_day == 100 and free.allowed == _ALL and free.custom
    assert free.max_active is None and free.dashboard == "full"
    assert resolve("nonsense").name == "free"
    assert resolve("MAX").trades_per_day == 100 and resolve("max").custom

    # free user may run any mix of templates, all enabled; unknown templates still drop.
    req = [
        {"template": "ma_crossover", "market": "I-BTC_INR", "enabled": True},
        {"template": "rsi", "market": "I-ETH_INR", "enabled": True},
        {"template": "squeeze_breakout", "market": "I-DOGE_INR", "enabled": True},
        {"template": "not_a_template", "market": "I-BTC_INR", "enabled": True},
    ]
    got = allowed_strategies("free", req)
    assert len(got) == 3 and sum(s["enabled"] for s in got) == 3, got

    # custom params are kept on every tier while pricing is off.
    cust = [{"template": "rsi", "market": "M", "enabled": True, "params": {"period": 9}}]
    assert allowed_strategies("free", cust)[0]["params"] == {"period": 9}
    assert allowed_strategies("max", cust)[0]["params"] == {"period": 9}
    print("entitlements self-check OK")
