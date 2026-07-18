"""Central loop: fetch candles -> run each strategy -> route signals to the executor.

Position model: long-only, flat<->long, full capital allocation.
  BUY  fires only when flat   -> qty = capital / price
  SELL fires only when long   -> qty = full open position (close)
The executor still owns all risk gating and idempotency.
"""
import logging
import math
import sys
import time

from . import audit, candles as candlemod, config, feeds, notify, reconcile, sizing
from .client import Client
from .executor import Executor
from .reliability import CircuitOpen
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
        self._bad_feed_alerted: dict[str, float] = {}  # market -> monotonic ts of last alert
        self._last_drift_check = 0.0                   # monotonic ts of last balance reconcile
        # Intraday crash brake (config engine.crash_brake, DEFAULT OFF): also check the
        # hard stop against the in-progress bar between daily closes. The v7 portfolio
        # study measured this at -107pts net / +5pts max-DD (intraday lows whipsaw
        # positions that recover by the close) - it exists for operators who want a
        # bounded worst intraday excursion and accept that documented cost. Divergence
        # from the close-based backtest is intentional and documented in FINDINGS v7.
        self.crash_brake = bool(cfg.get("engine", {}).get("crash_brake", False))
        # Portfolio-level BTC trend overlay (config portfolio.btc_regime_filter,
        # DEFAULT ON, entry_mult 0.0): scale/block NEW entries while BTC trades below
        # its 100d SMA. Promoted on v7 evidence: improves net, PF and worst
        # walk-forward fold on BOTH venues (FINDINGS v7). Exits are never touched.
        self.btc_filter = dict((cfg.get("portfolio") or {}).get("btc_regime_filter") or {})
        # Multi-source feed layer (v8, config engine.feeds, bot/feeds.py). Both fail-open:
        #   binance_fallback: B-*_USDT markets substitute Binance klines for ONE cycle
        #     when the primary feed is unusable (same asset+quote; INR pairs never).
        #   crosscheck: compare each newly closed bar's RETURN against the USDT twin's;
        #     divergence past max_divergence_pct pct-points -> HOLD that market + alert
        #     (a bad print that passes structural validation). Checked once per closed
        #     bar per market, not per poll, so the reference host sees a few requests/day.
        fcfg = dict((cfg.get("engine") or {}).get("feeds") or {})
        self.feed_fallback = bool(fcfg.get("binance_fallback", True))
        self.feed_crosscheck_pct = float(fcfg.get("max_divergence_pct", 10.0)) \
            if fcfg.get("crosscheck", True) else 0.0
        self._crosschecked: dict[str, int] = {}  # market -> last closed-bar ts verified
        # Adaptive polling (v8): poll fast for the first window after each bar close -
        # the only stretch where a fresh closed bar can be waiting - then relax. Signals
        # are unchanged (closed bars only); this only cuts entry/exit latency.
        self.poll_fast = int(cfg["engine"].get("poll_seconds_fast", 0) or 0)
        self.fast_window_s = int(cfg["engine"].get("fast_poll_window_minutes", 30) or 0) * 60

    _BAD_FEED_ALERT_EVERY = 3600.0   # rate-limit bad-candle alerts to one/hour per market
    _DRIFT_CHECK_EVERY = 3600.0      # LIVE balance-vs-book reconcile cadence

    def _validated_candles(self, market: str) -> list[dict] | None:
        """Fetch + integrity-check candles for a market. None = feed unusable this cycle
        (stale/gapped/malformed/diverged): the caller must HOLD - never trade on garbage
        bars. v8: an unusable primary can be substituted from the Binance reference for
        B-*_USDT markets, and a healthy-looking primary is cross-checked (once per newly
        closed bar) against the USDT twin to catch bad prints. Both layers fail open."""
        interval_ms = _INTERVAL_MS.get(self.interval, 86_400_000)
        bars = self.client.candles(market, self.interval, self.limit)
        rep = candlemod.validate(bars, interval_ms, now_ms=int(time.time() * 1000))
        if not rep.ok and self.feed_fallback and feeds.can_substitute(market):
            alt = feeds.fetch_reference(market, self.interval, self.limit)
            if alt:
                rep_alt = candlemod.validate(alt, interval_ms,
                                             now_ms=int(time.time() * 1000))
                if rep_alt.ok:
                    log.warning("PRIMARY FEED UNUSABLE for %s (%s) -> substituting the "
                                "Binance reference bars for this cycle",
                                market, "; ".join(rep.problems))
                    rep = rep_alt
        if rep.notes:
            log.info("candle feed normalized for %s: %s", market, "; ".join(rep.notes))
        if rep.ok and self.feed_crosscheck_pct > 0 and len(rep.bars) >= 2:
            closed_ts = int(rep.bars[-2]["time"])
            if self._crosschecked.get(market) != closed_ts:
                ref = feeds.fetch_reference(market, self.interval, 5)
                div = feeds.crosscheck_divergence(rep.bars, ref)
                if div is None or div[0] <= self.feed_crosscheck_pct:
                    # verified (or reference unavailable -> fail open); don't re-check this bar
                    self._crosschecked[market] = closed_ts
                else:
                    rep.ok = False
                    rep.problems.append(
                        f"crosscheck: closed-bar return diverges {div[0]:.1f}pp from the "
                        f"USDT reference (> {self.feed_crosscheck_pct:.1f}pp)")
        if rep.ok:
            return rep.bars
        log.warning("BAD CANDLE FEED for %s: %s -> holding (no trades this cycle)",
                    market, "; ".join(rep.problems))
        now = time.monotonic()
        if now - self._bad_feed_alerted.get(market, -1e12) >= self._BAD_FEED_ALERT_EVERY:
            self._bad_feed_alerted[market] = now
            notify.send(notify.bullets("Bad candle data - holding", [
                ("Market", market),
                ("Problem", "; ".join(rep.problems)[:200]),
                ("Action", "no trades on this market until the feed is healthy"),
            ]))
        return None

    @staticmethod
    def _build_strategy(s: dict, sleeves: dict, entries_enabled: bool):
        strat = build(s)
        # protective exits are config, not strategy logic -> attach to the instance
        strat.stop_loss_pct = float(s.get("stop_loss_pct", 0) or 0)
        strat.take_profit_pct = float(s.get("take_profit_pct", 0) or 0)
        strat.chandelier_k = float(s.get("chandelier_k", 0) or 0)
        strat.exit_atr_period = int(s.get("atr_period", s.get("params", {}).get("atr_period", 14)) or 14)
        strat.max_hold_bars = int(s.get("max_hold_bars", 0) or 0)
        # Optional per-sleeve execution layers (all default OFF; evidence in FINDINGS v7):
        strat.reentry_cooldown_bars = int(s.get("reentry_cooldown_bars", 0) or 0)
        strat.entry_slippage_cap_pct = float(s.get("entry_slippage_cap_pct", 0) or 0)
        strat.vol_target_ann = float(s.get("vol_target_ann", 0) or 0)
        strat.exit_ladder_frac = float(s.get("exit_ladder_frac", 0) or 0)
        strat.exit_ladder_k = float(s.get("exit_ladder_k", 3.5) or 3.5)
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

    def _overlay_mult(self, candle_cache: dict) -> float:
        """Portfolio BTC trend overlay entry multiplier for this cycle. 1.0 when the
        filter is disabled, BTC is above its regime line, or the BTC feed can't be
        judged (fail OPEN with a log line - blocking all entries on a feed outage would
        silently strangle the whole bot)."""
        f = self.btc_filter
        if not f or not f.get("enabled", False):
            return 1.0
        market = str(f.get("market", "I-BTC_INR"))
        period = int(f.get("period", 100))
        mult = float(f.get("entry_mult", 0.0))
        key = (market, self.interval)
        try:
            if key not in candle_cache:
                candle_cache[key] = self._validated_candles(market)
        except Exception:  # noqa: BLE001
            log.warning("BTC overlay: candle fetch failed; entries proceed unscaled")
            return 1.0
        bars = candle_cache[key]
        if not bars or len(bars) < period + 1:
            log.info("BTC overlay: insufficient %s history; entries proceed unscaled", market)
            return 1.0
        closes = [b["close"] for b in bars[:-1]]  # closed bars only, like everything else
        line = sum(closes[-period:]) / period
        if closes[-1] < line:
            log.info("BTC overlay ACTIVE: %s close %.0f < %dd SMA %.0f -> entry mult %.2f",
                     market, closes[-1], period, line, mult)
            return max(0.0, min(1.0, mult))
        return 1.0

    def _vol_target_mult(self, strat, closed: list[dict]) -> float:
        """Vol-targeted entry sizing (per-sleeve vol_target_ann, 0 = off): scale the
        entry down by target/realized when 20-bar realized annualized vol exceeds the
        target. Never scales UP (mult is capped at 1)."""
        target = strat.vol_target_ann
        if target <= 0 or len(closed) < 22:
            return 1.0
        closes = [b["close"] for b in closed[-21:]]
        rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
        m = sum(rets) / len(rets)
        var = sum((r - m) ** 2 for r in rets) / (len(rets) - 1)
        per_year = 365 * 86_400_000 / _INTERVAL_MS.get(self.interval, 86_400_000)
        rv = math.sqrt(var) * math.sqrt(per_year)
        if rv > target > 0:
            return target / rv
        return 1.0

    def _ladder_exit(self, strat, closed, price, pos_qty, peak, entry_ts) -> bool:
        """Partial-exit ladder for the regime-holding engines (per-sleeve
        exit_ladder_frac, 0 = off; only sensible when chandelier_k == 0): bank
        `exit_ladder_frac` of the position once price falls exit_ladder_k*ATR off its
        peak, ride the rest to the engine's own exit. Fires at most once per position
        (meta-keyed by entry_ts). v7 evidence: -2.1pts max-DD on INR, -1.2 on USDT,
        net neutral. Returns True if a partial sell was placed."""
        frac = strat.exit_ladder_frac
        if frac <= 0 or strat.chandelier_k or pos_qty <= 0 or entry_ts <= 0:
            return False
        key_done = audit.get_cooldown_until(f"ladder:{strat.name}", strat.market)
        if key_done == entry_ts:  # already laddered this position
            return False
        a = atr(closed, strat.exit_atr_period)
        if not a or price > peak - strat.exit_ladder_k * a:
            return False
        sell_qty = pos_qty * min(1.0, max(0.0, frac))
        log.info("LADDER %s %s: selling %.4g of %.4g at %.6g (peak %.6g)",
                 strat.name, strat.market, sell_qty, pos_qty, price, peak)
        self.executor.place(strategy=strat.name, market=strat.market, side="sell",
                            qty=sell_qty, price=price, candle_ts=closed[-1]["time"])
        audit.set_cooldown_until(f"ladder:{strat.name}", strat.market, entry_ts)
        return True

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
        overlay_mult: float | None = None  # computed lazily, once per cycle
        for strat in self.strategies:
            try:
                key = (strat.market, self.interval)
                if key not in candle_cache:
                    candle_cache[key] = self._validated_candles(strat.market)
                candles = candle_cache[key]
                if candles is None:  # integrity check failed -> HOLD, already alerted
                    continue
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
                    # 1a) optional intraday crash brake: the hard stop also checks the
                    # in-progress bar's close (the freshest price we have) between
                    # daily closes. Config-gated OFF; see __init__ for the honest cost.
                    if self.crash_brake and strat.stop_loss_pct and avg > 0:
                        live_px = candles[-1]["close"]
                        if live_px <= avg * (1 - strat.stop_loss_pct):
                            log.warning("CRASH_BRAKE %s %s live %.6g <= stop of avg %.6g "
                                        "-> intraday force SELL", strat.name, strat.market,
                                        live_px, avg)
                            notify.send(notify.bullets("Crash brake (intraday stop)", [
                                ("Market", strat.market), ("Strategy", strat.name),
                                ("Live price", f"{live_px}"), ("Avg cost", f"{avg}"),
                            ]))
                            self.executor.place(strategy=strat.name, market=strat.market,
                                                side="sell", qty=pos_qty, price=live_px,
                                                candle_ts=candles[-1]["time"])
                            if strat.reentry_cooldown_bars:
                                audit.set_cooldown_until(
                                    strat.name, strat.market,
                                    ts + strat.reentry_cooldown_bars * interval_ms)
                            continue
                    hit = self._exit_signal(strat, closed, price, avg, peak, bars_held)
                    if hit:
                        log.info("%s %s %s @ %s (avg %s) -> force SELL",
                                 hit, strat.name, strat.market, price, avg)
                        notify.send(notify.bullets("Protective exit", [
                            ("Market", strat.market), ("Strategy", strat.name),
                            ("Trigger", hit), ("Price", f"{price}"),
                            ("Avg cost", f"{avg}"),
                        ]))
                        self.executor.place(strategy=strat.name, market=strat.market,
                                            side="sell", qty=pos_qty, price=price, candle_ts=ts)
                        if hit == "STOP_LOSS" and strat.reentry_cooldown_bars:
                            # re-entry cooldown: no fresh BUY for N bars after a stop-out
                            audit.set_cooldown_until(
                                strat.name, strat.market,
                                ts + strat.reentry_cooldown_bars * interval_ms)
                        continue
                    # 1b) partial-exit ladder (regime engines, opt-in)
                    if self._ladder_exit(strat, closed, price, pos_qty, peak, entry_ts):
                        continue

                if action == "HOLD":
                    continue

                # 2) strategy signal
                if action == "BUY" and pos_qty <= 0 and strat.entries_enabled:
                    if strat.reentry_cooldown_bars and \
                            ts < audit.get_cooldown_until(strat.name, strat.market):
                        log.info("%s %s BUY skipped: re-entry cooldown active",
                                 strat.name, strat.market)
                        continue
                    # entry slippage cap: skip if the live price already ran away from
                    # the signal close (a market order would pay untested slippage)
                    if strat.entry_slippage_cap_pct:
                        live_px = candles[-1]["close"]
                        if live_px > price * (1 + strat.entry_slippage_cap_pct):
                            log.info("%s %s BUY skipped: live %.6g > close %.6g + %.1f%% cap",
                                     strat.name, strat.market, live_px, price,
                                     strat.entry_slippage_cap_pct * 100)
                            continue
                    if overlay_mult is None:
                        overlay_mult = self._overlay_mult(candle_cache)
                    mult = overlay_mult * self._vol_target_mult(strat, closed) \
                        * sizing.sleeve_derisk_mult(strat.name, strat.sleeve_frac, self.client)
                    if mult <= 0:
                        log.info("%s %s BUY skipped: entry multiplier 0 (overlay/derisk)",
                                 strat.name, strat.market)
                        continue
                    qty = sizing.target_qty(strat.market, price, self.client,
                                            strat.sleeve_frac, size_mult=mult)
                    if qty <= 0:
                        log.info("%s %s BUY skipped: sizing returned 0 (min-notional/balance)",
                                 strat.name, strat.market)
                        continue
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="buy", qty=qty, price=price, candle_ts=ts)
                elif action == "SELL" and pos_qty > 0:
                    self.executor.place(strategy=strat.name, market=strat.market,
                                        side="sell", qty=pos_qty, price=price, candle_ts=ts)
            except CircuitOpen as e:
                # The breaker already alerted once when it opened; per-cycle failures
                # while it cools down are expected - log quietly, no alert spam.
                log.warning("skipping %s: %s", strat.name, e)
            except Exception as e:  # noqa: BLE001 - one strategy failing must not kill the loop
                log.exception("strategy %s failed", strat.name)
                notify.send(notify.bullets("Strategy error", [
                    ("Strategy", strat.name), ("Error", str(e)),
                ]))

    def _startup_recovery(self) -> None:
        """Boot-time health + healing, in dependency order: refuse a corrupt DB, snapshot
        a healthy one, then (LIVE) resolve any order whose confirmation was lost."""
        broken = audit.integrity_check()
        if broken is not None:
            log.critical("bot.db FAILED integrity check: %s - refusing to trade on a "
                         "corrupt book. Restore data/backups/ or investigate.", broken)
            notify.send(notify.bullets("DATABASE CORRUPT - engine halted", [
                ("Problem", broken[:200]),
                ("Action", "restore data/backups/bot-*.db, then restart"),
            ]))
            raise SystemExit(2)
        path = audit.backup_db()
        if path:
            log.info("bot.db backed up to %s", path)
        if config.LIVE:
            try:
                changes = reconcile.heal_lost_confirmations(self.client)
            except Exception:  # noqa: BLE001 - reconcile trouble must not stop the engine
                log.exception("boot reconciliation failed")
                changes = []
            for line in changes:
                log.warning("RECONCILED: %s", line)
            if changes:
                notify.send(notify.bullets("Boot reconciliation", [
                    (f"#{i+1}", line) for i, line in enumerate(changes[:8])
                ]))

    def _maintenance(self) -> None:
        """Cheap periodic upkeep, called once per poll cycle: a daily DB snapshot
        (idempotent per UTC day) and, LIVE, an hourly wallet-vs-book drift check."""
        audit.backup_db()
        if config.LIVE and time.monotonic() - self._last_drift_check >= self._DRIFT_CHECK_EVERY:
            self._last_drift_check = time.monotonic()
            problems = reconcile.check_balance_drift(self.client)
            for p in problems:
                log.error("BALANCE DESYNC: %s", p)
            if problems:
                notify.send(notify.bullets("Balance desync detected", [
                    ("Issue", p[:200]) for p in problems[:5]
                ] + [("Action", "bot book and wallet disagree - investigate before "
                               "trusting sells; touch KILL to halt")]))

    _CRASH_WINDOW_S = 1800.0  # systemd crash-loop guard: window and threshold
    _CRASH_LIMIT = 5

    def _crash_loop_guard(self) -> None:
        """Under systemd Restart=always, a start-time crash respawns every RestartSec
        forever - hammering the exchange and burying the real error. Track our own start
        times in data/; past _CRASH_LIMIT starts inside _CRASH_WINDOW_S, alert once and
        sleep before proceeding so the loop is visibly throttled even if systemd isn't
        configured with StartLimitIntervalSec."""
        try:
            marker = config.DB_PATH.parent / "engine_starts"
            marker.parent.mkdir(parents=True, exist_ok=True)
            now = time.time()
            starts = []
            if marker.exists():
                starts = [float(x) for x in marker.read_text().split() if x.strip()]
            starts = [t for t in starts if now - t < self._CRASH_WINDOW_S] + [now]
            marker.write_text("\n".join(f"{t:.0f}" for t in starts[-20:]) + "\n")
            n = len(starts)
            if n >= self._CRASH_LIMIT:
                delay = min(600.0, 30.0 * (2 ** (n - self._CRASH_LIMIT)))
                log.critical("CRASH LOOP: %d engine starts in %.0f min - sleeping %.0fs "
                             "before continuing (check the log for the underlying error)",
                             n, self._CRASH_WINDOW_S / 60, delay)
                if n == self._CRASH_LIMIT:  # alert once per episode, not per restart
                    notify.send(notify.bullets("Engine crash loop detected", [
                        ("Restarts", f"{n} in {self._CRASH_WINDOW_S/60:.0f} min"),
                        ("Action", f"throttling restarts ({delay:.0f}s); check logs"),
                    ]))
                time.sleep(delay)
        except Exception:  # noqa: BLE001 - the guard itself must never block a start
            log.exception("crash-loop guard failed (continuing)")

    def run(self) -> None:
        _setup_logging()
        audit.init()
        log.info("Engine start | mode=%s | strategies=%s | interval=%s poll=%ss",
                 config.mode_str(), [s.name for s in self.strategies], self.interval, self.poll)
        self._crash_loop_guard()
        self._startup_recovery()
        self._sanity_check()
        # A config-only recycle (the supervisor restarting the engine after a strategy
        # change) sets SUPPRESS_START_ALERT so users don't get a spurious "bot started"
        # ping on every strategy edit. A real first start / go-live leaves it unset.
        if not config.SUPPRESS_START_ALERT:
            notify.send(notify.bullets("Bot started", [
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
            self._maintenance()
            # adaptive cadence (v8): fast polls right after a bar close, base otherwise
            time.sleep(feeds.poll_delay(self.poll, self.poll_fast, self.fast_window_s,
                                        _INTERVAL_MS.get(self.interval, 86_400_000),
                                        time.time()))


if __name__ == "__main__":
    Engine(config.load()).run()
