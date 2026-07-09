"""Global risk gate. Every order passes check() BEFORE it can be placed.
State is rebuilt from the audit DB, so restarts don't reset the day's limits.

Ceilings are FRACTIONS of live equity (constraint C), computed at check-time so a $1k
and a $5k wallet both scale. The no-leverage invariant (total deployed <= free balance)
makes max loss == wallet balance by construction. daily_loss_frac is a RUNAWAY-BUG circuit
breaker (stops a looping/erroring bot), NOT a market-risk cap — the user accepts full market
loss, but a bug firing many orders must still trip the kill path.
"""
import logging
from pathlib import Path

from . import audit, config, sizing

log = logging.getLogger("risk")

_EPS = 1e-9  # float tolerance for the no-leverage comparison


class RiskDecision:
    def __init__(self, ok: bool, reason: str = ""):
        self.ok = ok
        self.reason = reason


class RiskManager:
    def __init__(self, cfg: dict):
        r = cfg["risk"]
        self.max_position_frac = float(r.get("max_position_frac", 1.0))
        self.max_total_capital_at_risk_frac = float(r.get("max_total_capital_at_risk_frac", 1.0))
        self.daily_loss_frac = float(r.get("daily_loss_frac", 0.5))
        # Opt-in market-risk cap: peak-to-trough equity drawdown that blocks NEW entries.
        # 0 disables it (default), leaving the "user accepts full market loss" stance intact.
        self.drawdown_kill_frac = float(r.get("drawdown_kill_frac", 0.0) or 0.0)
        self.max_trades_per_day = int(r["max_trades_per_day"])
        self.kill_file = config.ROOT / r["kill_switch_file"]

    def kill_switch_active(self) -> bool:
        return Path(self.kill_file).exists()

    def check(self, notional: float, new_exposure: float, *,
              strategy: str = "", market: str = "", increasing: bool = True) -> RiskDecision:
        """notional = this trade's quote value; new_exposure = added open exposure (0 if closing)."""
        if self.kill_switch_active():
            return RiskDecision(False, "KILL SWITCH active")

        s = audit.today_stats()
        eq = sizing.equity()
        free = sizing.free_balance()

        # Runaway-bug circuit breaker: realized loss past a fraction of start-of-day equity.
        sod_equity = eq - s["realized_today"]
        if sod_equity > 0 and s["realized_today"] <= -self.daily_loss_frac * sod_equity:
            return RiskDecision(False, f"DAILY_LOSS_LIMIT hit (realized {s['realized_today']:.2f})")
        # Drawdown circuit breaker (opt-in): peak-to-trough equity decline past a fraction
        # blocks NEW entries only - protective exits (increasing=False) always pass, so a
        # tripped breaker can still stop out of open risk. sizing.drawdown() also refreshes
        # the high-water-mark. Disabled when drawdown_kill_frac <= 0.
        if increasing and self.drawdown_kill_frac > 0:
            dd = sizing.drawdown()
            if dd >= self.drawdown_kill_frac:
                return RiskDecision(
                    False,
                    f"DRAWDOWN_CIRCUIT_BREAKER (dd {dd:.1%} >= {self.drawdown_kill_frac:.0%})",
                )
        # Churn cap applies to INCREASING orders only: a position-closing sell (stop-loss,
        # chandelier, take-profit, kill path) must never be blocked by the day's trade count.
        # Runaway sells are still contained by per-candle idempotency, the daily-loss breaker
        # above, and the kill switch.
        if increasing and s["trades_today"] >= self.max_trades_per_day:
            return RiskDecision(False, f"MAX_TRADES_PER_DAY hit ({s['trades_today']})")
        if notional > self.max_position_frac * eq + _EPS:
            return RiskDecision(False, f"notional {notional:.2f} > MAX_POSITION {self.max_position_frac}*eq")
        if s["capital_at_risk"] + new_exposure > self.max_total_capital_at_risk_frac * eq + _EPS:
            return RiskDecision(
                False,
                f"capital_at_risk {s['capital_at_risk']:.2f}+{new_exposure:.2f} "
                f"> MAX_TOTAL_CAPITAL_AT_RISK {self.max_total_capital_at_risk_frac}*eq",
            )
        # No-duplicate-asset: don't let two strategies pile into the same market.
        if increasing and market and audit.position_held_by_other(strategy, market):
            return RiskDecision(False, "DUP_ASSET")
        # No-leverage invariant: never deploy more than the free cash on hand.
        if increasing and new_exposure > free + _EPS:
            return RiskDecision(False, f"INSUFFICIENT_BALANCE (need {new_exposure:.2f} > free {free:.2f})")
        return RiskDecision(True)


if __name__ == "__main__":
    # ponytail self-check: fractional limits + no-dup-asset actually block.
    audit.init()
    # Deterministic equity/free, no network, no live keys.
    sizing.equity = lambda *a, **k: 1000.0          # type: ignore[assignment]
    sizing.free_balance = lambda *a, **k: 1000.0     # type: ignore[assignment]
    rm = RiskManager({"risk": {
        "max_position_frac": 0.05, "max_total_capital_at_risk_frac": 0.2,
        "daily_loss_frac": 0.5, "max_trades_per_day": 20, "kill_switch_file": "KILL",
    }})
    assert rm.check(40, 40, strategy="a", market="X").ok
    assert not rm.check(60, 60, strategy="a", market="X").ok, "should block over max_position_frac*eq"
    assert not rm.check(40, 500, strategy="a", market="X").ok, "should block over capital-at-risk frac"
    # no-dup-asset: a different strategy holds the market.
    audit.position_held_by_other = lambda strat, mkt: True  # type: ignore[assignment]
    d = rm.check(40, 40, strategy="a", market="X")
    assert not d.ok and d.reason == "DUP_ASSET", ("should block dup asset", d.reason)
    # trade cap: blocks new entries, NEVER a position-closing sell (protective exits).
    audit.position_held_by_other = lambda strat, mkt: False  # type: ignore[assignment]
    audit.today_stats = lambda: {"trades_today": 99, "realized_today": 0.0,  # type: ignore[assignment]
                                 "tds_today": 0.0, "capital_at_risk": 0.0}
    d = rm.check(40, 40, strategy="a", market="X", increasing=True)
    assert not d.ok and "MAX_TRADES_PER_DAY" in d.reason, ("cap must block entries", d.reason)
    d = rm.check(40, 0, strategy="a", market="X", increasing=False)
    assert d.ok, ("cap must NOT block a closing sell", d.reason)
    # drawdown circuit breaker: blocks NEW entries past the frac, exits still allowed;
    # disabled when frac == 0.
    audit.today_stats = lambda: {"trades_today": 0, "realized_today": 0.0,  # type: ignore[assignment]
                                 "tds_today": 0.0, "capital_at_risk": 0.0}
    sizing.drawdown = lambda *a, **k: 0.20  # type: ignore[assignment]  # 20% below peak
    ddm = RiskManager({"risk": {
        "max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
        "daily_loss_frac": 0.5, "max_trades_per_day": 20, "kill_switch_file": "KILL",
        "drawdown_kill_frac": 0.15,
    }})
    d = ddm.check(40, 40, strategy="a", market="X", increasing=True)
    assert not d.ok and "DRAWDOWN_CIRCUIT_BREAKER" in d.reason, ("dd must block entries", d.reason)
    d = ddm.check(40, 0, strategy="a", market="X", increasing=False)
    assert d.ok, ("dd must NOT block a closing sell", d.reason)
    # disabled (frac 0) => same 20% drawdown does not block.
    assert rm.check(40, 40, strategy="a", market="X", increasing=True).ok, "dd breaker must be off when frac=0"
    print("risk self-check OK")
