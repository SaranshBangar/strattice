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
        self.strategies = []
        for s in cfg["strategies"]:
            if not s.get("enabled", True):
                continue
            strat = build(s)
            # protective exits are config, not strategy logic -> attach to the instance
            strat.stop_loss_pct = float(s.get("stop_loss_pct", 0) or 0)
            strat.take_profit_pct = float(s.get("take_profit_pct", 0) or 0)
            strat.chandelier_k = float(s.get("chandelier_k", 0) or 0)
            strat.exit_atr_period = int(s.get("atr_period", s.get("params", {}).get("atr_period", 14)) or 14)
            strat.max_hold_bars = int(s.get("max_hold_bars", 0) or 0)
            self.strategies.append(strat)

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
        """Warn loudly if the wallet can't clear exchange minimums. Sizing is wallet-scaled now,
        so per-trade notional is allocation_frac*equity, not a fixed per-strategy capital."""
        try:
            eq = sizing.equity(self.client)
            target = sizing.allocation_frac() * eq
            log.info("config: equity=%.2f -> target notional/trade ~%.2f (alloc_frac=%.2f)",
                     eq, target, sizing.allocation_frac())
        except Exception:  # noqa: BLE001 - sanity check must never stop startup
            log.debug("equity sanity check skipped (balance/market data unavailable)")
        for strat in self.strategies:
            try:
                min_n = self.client.min_notional(strat.market)
                if min_n:
                    log.info("config: %s min_notional=%.2f for %s", strat.name, min_n, strat.market)
            except Exception:  # noqa: BLE001
                log.debug("sanity check skipped for %s (market data unavailable)", strat.name)

    def run_once(self) -> None:
        for strat in self.strategies:
            try:
                candles = self.client.candles(strat.market, self.interval, self.limit)
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
                if action == "BUY" and pos_qty <= 0:
                    qty = sizing.target_qty(strat.market, price, self.client)
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
            self.run_once()
            time.sleep(self.poll)


if __name__ == "__main__":
    Engine(config.load()).run()
