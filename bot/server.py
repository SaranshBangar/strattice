"""Read-only JSON status endpoint for the dashboard PWA.

Reuses the same audit/config/sizing/risk logic as `bot.status`, but emits
structured JSON instead of text. Runs as its own process (stdlib only, no deps)
so it can sit next to the bot under systemd. It NEVER writes — pure read.

Run:  BOT_API_TOKEN=secret python -m bot.server            # 0.0.0.0:8787
Env:  BOT_API_TOKEN (required)  BOT_API_HOST  BOT_API_PORT
Test: curl "http://localhost:8787/api/status?token=secret"
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import audit, config, sizing
from .risk import RiskManager

TOKEN = os.environ.get("BOT_API_TOKEN", "")


def _payload() -> dict:
    audit.init()
    cfg = config.load()
    rm = RiskManager(cfg)
    s = audit.today_stats()
    q = sizing.quote_currency()
    fx = config.inr_per_usdt() if q != "INR" else None
    # Equity: in LIVE this reads the real wallet (signed balance call) — free quote
    # balance + cost basis of open positions. In DRY_RUN it falls back to book
    # (starting_equity + realized P&L). See sizing.equity()/free_balance().
    free = sizing.free_balance()              # one signed balance call in LIVE
    eq = free + s["capital_at_risk"]          # mirrors sizing.equity(); book in DRY_RUN
    sod = eq - s["realized_today"]
    return {
        "mode": config.mode_str(),
        "quote": q,
        "inr_per_usdt": fx,                       # null when wallet already INR
        "kill_switch": rm.kill_switch_active(),
        "equity": eq,
        "equity_basis": "live" if config.LIVE else "book",  # see _payload()
        "free": free,
        "trades_today": s["trades_today"],
        "max_trades_per_day": rm.max_trades_per_day,
        "realized_today": s["realized_today"],
        "loss_limit": rm.daily_loss_frac * sod,   # runaway breaker level (negative side)
        "tds_today": s["tds_today"],
        "capital_at_risk": s["capital_at_risk"],
        "cap_ceiling": rm.max_total_capital_at_risk_frac * eq,
        "total_realized": audit.total_realized(),
        "positions": [
            {"strategy": p["strategy"], "market": p["market"],
             "qty": p["qty"], "avg_price": p["avg_price"]}
            for p in audit.open_positions()
        ],
        "trades": _recent("orders", 30),
        "signals": _recent("signals", 30),
    }


def _recent(table: str, n: int) -> list[dict]:
    # ponytail: read-only SELECT on the bot's own tables; reuse audit's connection.
    con = audit._conn()
    try:
        rows = con.execute(
            f"SELECT * FROM {table} ORDER BY ts DESC LIMIT ?", (n,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request stderr spam
        pass

    def _send(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path not in ("/api/status", "/health"):
            return self._send(404, {"error": "not found"})
        if u.path == "/health":
            return self._send(200, {"ok": True})
        tok = parse_qs(u.query).get("token", [""])[0] or self.headers.get("X-Token", "")
        if not TOKEN or tok != TOKEN:
            return self._send(401, {"error": "unauthorized"})
        try:
            self._send(200, _payload())
        except Exception as e:                    # never 500 silently — surface it
            self._send(500, {"error": str(e)})


def main() -> None:
    if not TOKEN:
        sys.exit("refusing to start: set BOT_API_TOKEN")
    host = os.environ.get("BOT_API_HOST", "0.0.0.0")
    port = int(os.environ.get("BOT_API_PORT", "8787"))
    print(f"status server on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
