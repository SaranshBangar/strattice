"""Central loop: fetch candles -> run each strategy -> route signals to the executor.

Position model: long-only, flat<->long, full capital allocation.
  BUY  fires only when flat   -> qty = capital / price
  SELL fires only when long   -> qty = full open position (close)
The executor still owns all risk gating and idempotency.
"""
import logging
import sys
import time

from . import audit, config, notify
from .client import Client
from .executor import Executor
from .risk import RiskManager
from .strategies import build

log = logging.getLogger("engine")


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
            self.strategies.append(strat)

    @staticmethod
    def _protective_exit(strat, price: float, avg: float) -> str | None:
        """Return 'STOP_LOSS'/'TAKE_PROFIT' if a long position should be force-closed, else None."""
        if avg <= 0:
            return None
        if strat.stop_loss_pct and price <= avg * (1 - strat.stop_loss_pct):
            return "STOP_LOSS"
        if strat.take_profit_pct and price >= avg * (1 + strat.take_profit_pct):
            return "TAKE_PROFIT"
        return None

    def _sanity_check(self) -> None:
        """Warn loudly if capital can't clear exchange minimums or breaches risk ceilings."""
        ceiling = self.risk.max_total_capital_at_risk
        deployable = sum(s.capital for s in self.strategies)
        if deployable > ceiling:
            log.warning("config: summed strategy capital %.2f > max_total_capital_at_risk %.2f "
                        "-> later strategies will be risk-blocked", deployable, ceiling)
        for strat in self.strategies:
            try:
                min_q = self.client.min_quantity(strat.market)
                last = self.client.candles(strat.market, self.interval, 2)[-1]["close"]
                if min_q and strat.capital < min_q * last:
                    log.warning("config: %s capital %.2f < min order %.2f for %s "
                                "-> trades will be skipped below_min_qty",
                                strat.name, strat.capital, min_q * last, strat.market)
                if strat.capital > self.risk.max_position_size:
                    log.warning("config: %s capital %.2f > max_position_size %.2f -> risk-blocked",
                                strat.name, strat.capital, self.risk.max_position_size)
            except Exception:  # noqa: BLE001 - sanity check must never stop startup
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
                    hit = self._protective_exit(strat, price, avg)
                    if hit:
                        log.info("%s %s %s @ %s (avg %s) -> force SELL",
                                 hit, strat.name, strat.market, price, avg)
                        notify.send(f"🛡️ {hit} {strat.market} [{strat.name}] @ {price} (avg {avg})")
                        self.executor.place(strategy=strat.name, market=strat.market,
                                            side="sell", qty=pos_qty, price=price, candle_ts=ts)
                        continue

                if action == "HOLD":
                    continue

                # 2) strategy signal
                if action == "BUY" and pos_qty <= 0:
                    qty = strat.capital / price
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="buy", qty=qty, price=price, candle_ts=ts)
                elif action == "SELL" and pos_qty > 0:
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="sell", qty=pos_qty, price=price, candle_ts=ts)
            except Exception as e:  # noqa: BLE001 - one strategy failing must not kill the loop
                log.exception("strategy %s failed", strat.name)
                notify.send(f"🚨 Strategy {strat.name} error: {e}")

    def run(self) -> None:
        _setup_logging()
        audit.init()
        log.info("Engine start | mode=%s | strategies=%s | interval=%s poll=%ss",
                 config.mode_str(), [s.name for s in self.strategies], self.interval, self.poll)
        self._sanity_check()
        notify.send(f"🤖 Bot started [{config.mode_str()}] strategies={[s.name for s in self.strategies]}")
        while True:
            if self.risk.kill_switch_active():
                self.executor.kill()
                log.critical("Halted by kill switch. Remove '%s' to resume.", self.risk.kill_file)
                break
            self.run_once()
            time.sleep(self.poll)


if __name__ == "__main__":
    Engine(config.load()).run()
