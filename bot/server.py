"""JSON status + strategy-toggle endpoint for the dashboard PWA.

Reuses the same audit/config/sizing/risk logic as `bot.status`, but emits
structured JSON instead of text. Runs as its own process (stdlib only, no deps)
so it can sit next to the bot under systemd. GET /api/status is pure read; the
one exception is POST /api/strategy, which rewrites config.yaml to flip a single
strategy's `enabled` flag (targeted line edit — preserves comments/formatting).
The running engine re-reads that flag each poll cycle, so the toggle takes effect
without a restart.

Run:  BOT_API_TOKEN=secret python -m bot.server            # 0.0.0.0:8787
Env:  BOT_API_TOKEN (required)  BOT_API_HOST  BOT_API_PORT
Test: curl "http://localhost:8787/api/status?token=secret"
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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
        "strategies": [
            {"name": st["name"], "market": st["market"],
             "enabled": bool(st.get("enabled", True))}
            for st in cfg["strategies"]
        ],
        "positions": [
            {"strategy": p["strategy"], "market": p["market"],
             "qty": p["qty"], "avg_price": p["avg_price"]}
            for p in audit.open_positions()
        ],
        "trades": _recent("orders", 30),
        "signals": _recent("signals", 30),
    }


def _recent(table: str, n: int) -> list[dict]:
    # ponytail: read-only SELECT on the bot's own tables; reuse audit's shared connection
    # (a single persistent connection per process now, not one opened-and-closed per call —
    # so this must NOT close it; audit._lock is what serializes access across threads).
    with audit._lock, audit._conn() as con:
        rows = con.execute(
            f"SELECT * FROM {table} ORDER BY ts DESC LIMIT ?", (n,)
        ).fetchall()
        return [dict(r) for r in rows]


def _signals_by_action(action: str) -> list[dict]:
    """ALL signals for a single action (BUY/SELL) — unlike /api/status's latest-30
    payload (mostly HOLD, since a signal is logged every poll cycle regardless of
    action), this is not capped: every matching row in the table is returned."""
    with audit._lock, audit._conn() as con:
        rows = con.execute(
            "SELECT * FROM signals WHERE action=? ORDER BY ts DESC", (action.upper(),)
        ).fetchall()
        return [dict(r) for r in rows]


_NAME_RE = re.compile(r'^\s*-\s+name:\s*["\']?{}["\']?\s*(#.*)?$')
_ITEM_RE = re.compile(r'^\s*-\s+name:\s*')
_EN_RE = re.compile(r'^(\s*)enabled:\s*(?:true|false)(.*)$')


def _set_enabled(name: str, enabled: bool, path: Path | None = None) -> bool:
    """Flip one strategy's `enabled` flag in config.yaml via a targeted line edit.

    No yaml round-trip — config.yaml is heavily commented and safe_load would drop
    the comments. We find the strategy's `- name:` line, then flip the first
    `enabled:` line before the next strategy item. Every other byte is preserved.
    Returns False if `name` isn't a known strategy (caller -> 404)."""
    p = path or (config.ROOT / "config.yaml")
    lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
    name_re = re.compile(_NAME_RE.pattern.format(re.escape(name)))
    start = next((k for k, ln in enumerate(lines) if name_re.match(ln)), None)
    if start is None:
        return False
    for j in range(start + 1, len(lines)):
        if _ITEM_RE.match(lines[j]):
            break  # next strategy reached without an enabled: line
        m = _EN_RE.match(lines[j])
        if m:
            lines[j] = f"{m.group(1)}enabled: {'true' if enabled else 'false'}{m.group(2)}\n"
            p.write_text("".join(lines), encoding="utf-8")
            return True
    return False


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
        if u.path not in ("/api/status", "/api/signals", "/health"):
            return self._send(404, {"error": "not found"})
        if u.path == "/health":
            return self._send(200, {"ok": True})
        tok = parse_qs(u.query).get("token", [""])[0] or self.headers.get("X-Token", "")
        if not TOKEN or tok != TOKEN:
            return self._send(401, {"error": "unauthorized"})
        try:
            if u.path == "/api/signals":
                action = parse_qs(u.query).get("action", [""])[0].lower()
                if action not in ("buy", "sell"):
                    return self._send(400, {"error": "action must be 'buy' or 'sell'"})
                return self._send(200, {"signals": _signals_by_action(action)})
            self._send(200, _payload())
        except Exception as e:                    # never 500 silently — surface it
            self._send(500, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/strategy":
            return self._send(404, {"error": "not found"})
        tok = parse_qs(u.query).get("token", [""])[0] or self.headers.get("X-Token", "")
        if not TOKEN or tok != TOKEN:
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            name, enabled = body.get("name"), body.get("enabled")
            if not isinstance(name, str) or not isinstance(enabled, bool):
                return self._send(400, {"error": "need {name: str, enabled: bool}"})
            if not _set_enabled(name, enabled):
                return self._send(404, {"error": f"unknown strategy: {name}"})
            self._send(200, {"name": name, "enabled": enabled})
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
