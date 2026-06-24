"""Quick status summary. Run: python -m bot.status"""
import sys

from . import audit, config, sizing
from .risk import RiskManager


def summary() -> str:
    audit.init()
    cfg = config.load()
    rm = RiskManager(cfg)
    s = audit.today_stats()
    q = sizing.quote_currency()
    # ₹ equivalent only makes sense when the wallet isn't already INR.
    fx = config.inr_per_usdt() if q != "INR" else None
    inr = (lambda v: f" (₹{v * fx:.0f})") if fx else (lambda v: "")
    eq = sizing.equity()
    free = sizing.free_balance()
    sod = eq - s["realized_today"]
    loss_limit = rm.daily_loss_frac * sod
    cap_ceiling = rm.max_total_capital_at_risk_frac * eq
    lines = [
        f"mode:            {config.mode_str()}",
        f"kill switch:     {'ACTIVE' if rm.kill_switch_active() else 'off'}",
        f"equity:          {eq:.2f} {q}{inr(eq)}  free: {free:.2f}",
        f"trades today:    {s['trades_today']} / {rm.max_trades_per_day}",
        f"realized today:  {s['realized_today']:.2f} {q}{inr(s['realized_today'])}"
        f"  (runaway breaker at -{loss_limit:.2f} {q} = {rm.daily_loss_frac:.0%} of SoD equity)",
        f"TDS paid today:  {s['tds_today']:.2f} {q}{inr(s['tds_today'])}",
        f"capital at risk: {s['capital_at_risk']:.2f} / {cap_ceiling:.2f} {q}"
        f"{inr(s['capital_at_risk'])}",
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
