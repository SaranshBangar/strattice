"""Central loop: fetch candles -> run each strategy -> route signals to the executor.

Position model: long-only, flat<->long, full capital allocation.
  BUY  fires only when flat   -> qty = capital / price
  SELL fires only when long   -> qty = full open position (close)
The executor still owns all risk gating and idempotency.
"""
import logging
import sys
import time

from . import audit, config, notify, sizing
from .client import Client
from .executor import Executor
from .risk import RiskManager
from .strategies import build
from .strategies.base import atr

log = logging.getLogger("engine")

# Candle interval -> milliseconds, for the bars-held time-stop.
_INTERVAL_MS = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "1d": 86_400_000, "1w": 604_800_000,
}


def _setup_logging() -> None:
    config.LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    # ponytail: force utf-8 so emoji in alerts don't crash on Windows cp1252 console/file
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(config.LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.interval = cfg["engine"]["candle_interval"]
        self.limit = int(cfg["engine"]["candle_limit"])
        self.poll = int(cfg["engine"]["poll_seconds"])
        self.client = Client()
        self.risk = RiskManager(cfg)
        self.executor = Executor(cfg, self.client, self.risk)
        self.strategies = self._build_strategies(cfg)

    @staticmethod
    def _build_strategy(s: dict, sleeves: dict, entries_enabled: bool):
        strat = build(s)
        # protective exits are config, not strategy logic -> attach to the instance
        strat.stop_loss_pct = float(s.get("stop_loss_pct", 0) or 0)
        strat.take_profit_pct = float(s.get("take_profit_pct", 0) or 0)
        strat.chandelier_k = float(s.get("chandelier_k", 0) or 0)
        strat.exit_atr_period = int(s.get("atr_period", s.get("params", {}).get("atr_period", 14)) or 14)
        strat.max_hold_bars = int(s.get("max_hold_bars", 0) or 0)
        strat.sleeve_frac = sleeves.get(strat.name, 0.0)  # fraction of equity this strategy may deploy
        strat.entries_enabled = entries_enabled           # disabled-but-open -> exits only, no new BUYs
        return strat

    def _build_strategies(self, cfg: dict) -> list:
        """Active set = every enabled strategy, PLUS any disabled strategy that still holds an
        open position (entries_enabled=False) so the engine keeps managing its exits until flat.
        Sleeves derive from the enabled set only; a managed-exit strategy gets sleeve 0 (it never
        sizes a new entry anyway). Shared by __init__ and the per-loop reconcile."""
        sleeves = sizing.sleeve_fracs(cfg)  # per-strategy capital sleeve for concurrent positions
        out = []
        for s in cfg["strategies"]:
            if s.get("enabled", True):
                out.append(self._build_strategy(s, sleeves, True))
            elif audit.get_position(s["name"], s["market"])[0] > 0:
                out.append(self._build_strategy(s, sleeves, False))
        return out

    def _reconcile(self) -> None:
        """Re-read config.yaml each poll and rebuild self.strategies only when the active set or
        any entries-enabled flag actually changed (reparse is sub-ms vs the 180s loop). The portal
        flips `enabled` in config.yaml; this is what makes the toggle live without a restart.
        Open-position state lives in the audit DB (keyed by name+market), not the strategy object,
        so dropping/rebuilding objects never loses a position."""
        try:
            new = self._build_strategies(config.load())
        except Exception:  # noqa: BLE001 - a bad/half-written config must not kill the loop
            log.exception("config reload failed; keeping current strategies")
            return
        sig = lambda xs: {(s.name, s.entries_enabled) for s in xs}
        if sig(new) != sig(self.strategies):
            log.info("strategy set changed: %s -> %s",
                     sorted(f"{s.name}{'' if s.entries_enabled else '(exit-only)'}" for s in self.strategies),
                     sorted(f"{s.name}{'' if s.entries_enabled else '(exit-only)'}" for s in new))
            self.strategies = new

    def _exit_signal(self, strat, candles, price, avg, peak, bars_held) -> str | None:
        """Force-close reasons for an open long (same precedence as the backtest):
        stop-loss, take-profit (target), time-stop, then ATR chandelier trailing stop."""
        if avg <= 0:
            return None
        if strat.stop_loss_pct and price <= avg * (1 - strat.stop_loss_pct):
            return "STOP_LOSS"
        if strat.take_profit_pct and price >= avg * (1 + strat.take_profit_pct):
            return "TAKE_PROFIT"
        if strat.max_hold_bars and bars_held >= strat.max_hold_bars:
            return "TIME_STOP"
        if strat.chandelier_k:
            a = atr(candles, strat.exit_atr_period)
            if a and price <= peak - strat.chandelier_k * a:
                return "CHANDELIER"
        return None

    def _sanity_check(self) -> None:
        """Warn loudly if a SLEEVE can't clear exchange minimums. Each strategy now sizes to its
        own capital sleeve (sleeve_frac*equity), not the whole wallet, so a small wallet split
        across many strategies can fall below a pair's min-notional. Warn at startup; the executor
        independently refuses sub-min orders, so this never emits one — it just surfaces it early."""
        try:
            eq = sizing.equity(self.client)
        except Exception:  # noqa: BLE001 - sanity check must never stop startup
            log.debug("equity sanity check skipped (balance/market data unavailable)")
            eq = 0.0
        for strat in self.strategies:
            try:
                min_n = self.client.min_notional(strat.market)
            except Exception:  # noqa: BLE001
                log.debug("sanity check skipped for %s (market data unavailable)", strat.name)
                continue
            sleeve_notional = strat.sleeve_frac * eq
            log.info("config: %s sleeve_frac=%.3f -> notional ~%.2f (min_notional=%.2f) on %s",
                     strat.name, strat.sleeve_frac, sleeve_notional, min_n, strat.market)
            if eq and sizing.sleeve_too_small(strat.sleeve_frac, eq, min_n):
                log.warning("SLEEVE TOO SMALL: %s sleeve ~%.2f < min_notional %.2f on %s -> it will "
                            "never trade. Raise its weight, cut strategies, or fund the wallet.",
                            strat.name, sleeve_notional, min_n, strat.market)

    def run_once(self) -> None:
        # Strategies can share a market (e.g. two strategies both on I-BTC_INR); memoize the
        # candle fetch per (market, interval) for this pass so they don't each issue their own
        # duplicate public HTTP GET. Cleared every call so the next pass fetches fresh data.
        candle_cache: dict[tuple[str, str], list[dict]] = {}
        for strat in self.strategies:
            try:
                key = (strat.market, self.interval)
                if key not in candle_cache:
                    candle_cache[key] = self.client.candles(strat.market, self.interval, self.limit)
                candles = candle_cache[key]
                if len(candles) < max(strat.min_candles + 1, 2):
                    continue
                closed = candles[:-1]  # drop in-progress bar -> no repainting
                last = closed[-1]
                price, ts = last["close"], last["time"]

                action = strat.decide(closed)
                audit.log_signal(strat.name, strat.market, action, price)

                pos_qty, avg = audit.get_position(strat.name, strat.market)

                # 1) protective exit overrides the strategy signal (safety first)
                if pos_qty > 0:
                    audit.update_peak(strat.name, strat.market, price)
                    peak, entry_ts = audit.get_meta(strat.name, strat.market)
                    interval_ms = _INTERVAL_MS.get(self.interval, 3_600_000)
                    bars_held = int((ts - entry_ts) // interval_ms) if entry_ts else 0
                    hit = self._exit_signal(strat, closed, price, avg, peak, bars_held)
                    if hit:
                        log.info("%s %s %s @ %s (avg %s) -> force SELL",
                                 hit, strat.name, strat.market, price, avg)
                        notify.send(notify.table("PROTECTIVE EXIT", [
                            ("Trigger", hit), ("Market", strat.market),
                            ("Strategy", strat.name), ("Price", f"{price}"),
                            ("Avg Cost", f"{avg}"),
                        ]))
                        self.executor.place(strategy=strat.name, market=strat.market,
                                            side="sell", qty=pos_qty, price=price, candle_ts=ts)
                        continue

                if action == "HOLD":
                    continue

                # 2) strategy signal
                if action == "BUY" and pos_qty <= 0 and strat.entries_enabled:
                    qty = sizing.target_qty(strat.market, price, self.client, strat.sleeve_frac)
                    if qty <= 0:
                        log.info("%s %s BUY skipped: sizing returned 0 (min-notional/balance)",
                                 strat.name, strat.market)
                        continue
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="buy", qty=qty, price=price, candle_ts=ts)
                elif action == "SELL" and pos_qty > 0:
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="sell", qty=pos_qty, price=price, candle_ts=ts)
            except Exception as e:  # noqa: BLE001 - one strategy failing must not kill the loop
                log.exception("strategy %s failed", strat.name)
                notify.send(notify.table("STRATEGY ERROR", [
                    ("Strategy", strat.name), ("Error", str(e)),
                ]))

    def run(self) -> None:
        _setup_logging()
        audit.init()
        log.info("Engine start | mode=%s | strategies=%s | interval=%s poll=%ss",
                 config.mode_str(), [s.name for s in self.strategies], self.interval, self.poll)
        self._sanity_check()
        notify.send(notify.table("BOT STARTED", [
            ("Mode", config.mode_str()),
            ("Strategies", ", ".join(s.name for s in self.strategies)),
        ]))
        while True:
            if self.risk.kill_switch_active():
                self.executor.kill()
                log.critical("Halted by kill switch. Remove '%s' to resume.", self.risk.kill_file)
                break
            self._reconcile()  # pick up portal on/off toggles before this cycle's run
            self.run_once()
            time.sleep(self.poll)


if __name__ == "__main__":
    Engine(config.load()).run()
