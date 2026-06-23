"""Global risk gate. Every order passes check() BEFORE it can be placed.
State is rebuilt from the audit DB, so restarts don't reset the day's limits.
"""
import logging
from pathlib import Path

from . import audit, config

log = logging.getLogger("risk")


class RiskDecision:
    def __init__(self, ok: bool, reason: str = ""):
        self.ok = ok
        self.reason = reason


class RiskManager:
    def __init__(self, cfg: dict):
        r = cfg["risk"]
        self.max_position_size = float(r["max_position_size"])
        self.daily_loss_limit = float(r["daily_loss_limit"])
        self.max_trades_per_day = int(r["max_trades_per_day"])
        self.max_total_capital_at_risk = float(r["max_total_capital_at_risk"])
        self.kill_file = config.ROOT / r["kill_switch_file"]

    def kill_switch_active(self) -> bool:
        return Path(self.kill_file).exists()

    def check(self, notional: float, new_exposure: float) -> RiskDecision:
        """notional = this trade's quote value; new_exposure = added open exposure (0 if closing)."""
        if self.kill_switch_active():
            return RiskDecision(False, "KILL SWITCH active")

        s = audit.today_stats()

        if s["realized_today"] <= -self.daily_loss_limit:
            return RiskDecision(False, f"DAILY_LOSS_LIMIT hit (realized {s['realized_today']:.2f})")
        if s["trades_today"] >= self.max_trades_per_day:
            return RiskDecision(False, f"MAX_TRADES_PER_DAY hit ({s['trades_today']})")
        if notional > self.max_position_size:
            return RiskDecision(False, f"notional {notional:.2f} > MAX_POSITION_SIZE {self.max_position_size}")
        if s["capital_at_risk"] + new_exposure > self.max_total_capital_at_risk:
            return RiskDecision(
                False,
                f"capital_at_risk {s['capital_at_risk']:.2f}+{new_exposure:.2f} "
                f"> MAX_TOTAL_CAPITAL_AT_RISK {self.max_total_capital_at_risk}",
            )
        return RiskDecision(True)


if __name__ == "__main__":
    # ponytail self-check: limits actually block.
    audit.init()
    rm = RiskManager({"risk": {
        "max_position_size": 50, "daily_loss_limit": 100,
        "max_trades_per_day": 20, "max_total_capital_at_risk": 200,
        "kill_switch_file": "KILL",
    }})
    assert rm.check(40, 40).ok
    assert not rm.check(60, 60).ok, "should block over max_position_size"
    assert not rm.check(40, 500).ok, "should block over capital-at-risk ceiling"
    print("risk self-check OK")
