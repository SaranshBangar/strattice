"""Quick status summary. Run: python -m bot.status"""
import sys

from . import audit, config
from .risk import RiskManager


def summary() -> str:
    audit.init()
    cfg = config.load()
    rm = RiskManager(cfg)
    s = audit.today_stats()
    r = cfg["risk"]
    fx = config.inr_per_usdt()
    lines = [
        f"mode:            {config.mode_str()}",
        f"kill switch:     {'ACTIVE' if rm.kill_switch_active() else 'off'}",
        f"trades today:    {s['trades_today']} / {r['max_trades_per_day']}",
        f"realized today:  {s['realized_today']:.2f} USDT (₹{s['realized_today'] * fx:.0f})"
        f"  (loss limit {-r['daily_loss_limit']} USDT / ₹{-r['daily_loss_limit'] * fx:.0f})",
        f"capital at risk: {s['capital_at_risk']:.2f} / {r['max_total_capital_at_risk']} USDT"
        f"  (₹{s['capital_at_risk'] * fx:.0f} of ₹{r['max_total_capital_at_risk'] * fx:.0f})",
        "open positions:",
    ]
    pos = audit.open_positions()
    if not pos:
        lines.append("  (none)")
    for p in pos:
        lines.append(f"  {p['strategy']:14} {p['market']:14} qty={p['qty']} avg={p['avg_price']}")
    return "\n".join(lines)


if __name__ == "__main__":
    # force utf-8 so the ₹ symbol doesn't crash on Windows cp1252 console
    sys.stdout.reconfigure(encoding="utf-8")
    print(summary())
