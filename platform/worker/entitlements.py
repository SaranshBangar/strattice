"""Tier -> entitlements. Single source of truth for what each subscription tier unlocks.

Mirrors platform/RESEARCH.md §3. The Next.js app MUST agree with this table; keep them in
sync (or have Next.js read it). Enforced here in the supervisor as the last line of defense:
even if the UI lets a user enable a forbidden strategy, resolve() + config_gen drop it.
"""
from __future__ import annotations

from dataclasses import dataclass

# Strategy templates we offer = the bot's REGISTRY (bot/strategies/__init__.py).
ALL_TEMPLATES = (
    "ma_crossover", "rsi", "momentum", "vol_expansion",
    "fast_rsi", "bb_reversion", "squeeze_breakout",
)
DEFAULT_TEMPLATE = "ma_crossover"  # the one free/starter users get


@dataclass(frozen=True)
class Tier:
    name: str
    price_inr: int
    trades_per_day: int
    max_active: int | None      # None = unlimited (all templates)
    allowed: frozenset[str]     # which templates this tier may run
    custom: bool                # may build custom (parameterized) strategies
    dashboard: str              # "basic" | "full"


_DEFAULT_ONLY = frozenset({DEFAULT_TEMPLATE})
_ALL = frozenset(ALL_TEMPLATES)

TIERS: dict[str, Tier] = {
    "free":    Tier("free",      0,   5, 1, _DEFAULT_ONLY, False, "basic"),
    "starter": Tier("starter", 299,  50, 1, _DEFAULT_ONLY, False, "basic"),
    "plus":    Tier("plus",    499,  50, 3, _ALL,          False, "full"),
    "pro":     Tier("pro",     749,  75, None, _ALL,       False, "full"),
    "max":     Tier("max",     999, 100, None, _ALL,       True,  "full"),
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
    # self-check: caps + allowlist + custom gating actually bind.
    free = resolve("free")
    assert free.trades_per_day == 5 and free.allowed == _DEFAULT_ONLY
    assert resolve("nonsense").name == "free"
    assert resolve("MAX").trades_per_day == 100 and resolve("max").custom

    # free user requesting 3 strategies incl. a forbidden one -> only 1 default, enabled.
    req = [
        {"template": "ma_crossover", "market": "I-BTC_INR", "enabled": True},
        {"template": "rsi", "market": "I-ETH_INR", "enabled": True},          # not allowed on free
        {"template": "ma_crossover", "market": "I-ETH_INR", "enabled": True}, # over max_active=1
    ]
    got = allowed_strategies("free", req)
    assert all(s["template"] == "ma_crossover" for s in got), got
    assert sum(s["enabled"] for s in got) == 1, ("free caps to 1 active", got)

    # plus: any 3, cap enforced at 3 active.
    req5 = [{"template": tpl, "market": "M", "enabled": True} for tpl in ALL_TEMPLATES[:5]]
    got = allowed_strategies("plus", req5)
    assert sum(s["enabled"] for s in got) == 3, ("plus caps to 3 active", got)

    # custom params stripped for non-custom tier, kept for max.
    cust = [{"template": "rsi", "market": "M", "enabled": True, "params": {"period": 9}}]
    assert allowed_strategies("pro", cust)[0]["params"] is None
    assert allowed_strategies("max", cust)[0]["params"] == {"period": 9}
    print("entitlements self-check OK")
