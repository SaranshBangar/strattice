"""Tests for the v7 execution/risk features (portfolio overlays + per-sleeve knobs).

Deterministic, no network (reuses the FakeClient world from test_fallbacks). Run:

    python -m bot.test_portfolio_features
"""
from __future__ import annotations

import tempfile
import time as _time
from pathlib import Path

from .test_fallbacks import DAY, FakeClient, _bars, _fresh_world


def _fresh(tmp: Path, **cfg_extra):
    from . import sizing
    eng, fake = _fresh_world(tmp)
    for k, v in cfg_extra.items():
        eng.cfg[k] = v
    sizing.equity = lambda *a, **k: 100000.0
    sizing.free_balance = lambda *a, **k: 100000.0
    return eng, fake


def _healthy_bars(n: int = 400, price: float = 100.0, rising: bool = True) -> list[dict]:
    """Timestamps end 'now' (passes staleness); rising = +1%/day compounding (strong
    enough momentum that tsmom actually signals BUY), falling = -0.5%/day."""
    now = int(_time.time() * 1000)
    start = now - (n - 1) * DAY
    out = []
    px = price
    for i in range(n):
        px *= 1.01 if rising else 0.995
        out.append({"time": start + i * DAY, "open": px, "high": px * 1.01,
                    "low": px * 0.99, "close": px, "volume": 10.0})
    return out


def test_risk_new_entry_cap(tmp: Path) -> None:
    from . import audit, sizing
    from .risk import RiskManager

    eng, _ = _fresh(tmp)
    rm = RiskManager({"risk": {
        "max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
        "daily_loss_frac": 0.5, "max_trades_per_day": 50,
        "kill_switch_file": str(tmp / "KILL"), "max_new_entries_per_day": 2,
    }})
    old = audit.today_stats
    try:
        audit.today_stats = lambda: {"trades_today": 3, "realized_today": 0.0,
                                     "tds_today": 0.0, "capital_at_risk": 0.0,
                                     "buys_today": 2}
        d = rm.check(100, 100, strategy="a", market="I-ETH_INR", increasing=True)
        assert not d.ok and "MAX_NEW_ENTRIES_PER_DAY" in d.reason, d.reason
        # sells (protective exits) are never capped by the entry throttle
        d = rm.check(100, 0, strategy="a", market="I-ETH_INR", increasing=False)
        assert d.ok, d.reason
        # under the cap: entries pass
        audit.today_stats = lambda: {"trades_today": 3, "realized_today": 0.0,
                                     "tds_today": 0.0, "capital_at_risk": 0.0,
                                     "buys_today": 1}
        assert rm.check(100, 100, strategy="a", market="I-ETH_INR", increasing=True).ok
    finally:
        audit.today_stats = old
    _ = sizing  # keep the monkeypatched sizing alive for the whole test


def test_risk_consecutive_loss_halt(tmp: Path) -> None:
    from . import audit
    from .risk import RiskManager

    eng, _ = _fresh(tmp)
    # write 3 losing round-trip closes (sells) + interleaved buys (buys must not count)
    for i, pnl in enumerate([(-5, "sell"), (-1, "buy"), (-7, "sell"), (-4, "sell")]):
        audit.log_order({"client_order_id": f"cl{i}", "strategy": "s", "market": "I-ETH_INR",
                         "side": pnl[1], "qty": 1, "price": 100, "notional": 100,
                         "status": "dry_run", "dry_run": True, "realized_pnl": pnl[0]})
    assert audit.consecutive_losses() == 3, audit.consecutive_losses()
    rm = RiskManager({"risk": {
        "max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
        "daily_loss_frac": 0.5, "max_trades_per_day": 50,
        "kill_switch_file": str(tmp / "KILL"), "max_consecutive_losses_halt": 3,
    }})
    d = rm.check(100, 100, strategy="s", market="I-ETH_INR", increasing=True)
    assert not d.ok and "CONSECUTIVE_LOSS_HALT" in d.reason, d.reason
    # exits still pass; a win resets the streak
    assert rm.check(100, 0, strategy="s", market="I-ETH_INR", increasing=False).ok
    audit.log_order({"client_order_id": "clw", "strategy": "s", "market": "I-ETH_INR",
                     "side": "sell", "qty": 1, "price": 100, "notional": 100,
                     "status": "dry_run", "dry_run": True, "realized_pnl": 12.0})
    assert audit.consecutive_losses() == 0
    assert rm.check(100, 100, strategy="s", market="I-ETH_INR", increasing=True).ok


def test_risk_bucket_exposure_cap(tmp: Path) -> None:
    from . import audit
    from .risk import RiskManager

    eng, _ = _fresh(tmp)
    audit.set_position("s1", "I-ETH_INR", 10.0, 5000.0, 5000.0, 0)   # 50k crypto exposure
    rm = RiskManager({"risk": {
        "max_position_frac": 1.0, "max_total_capital_at_risk_frac": 1.0,
        "daily_loss_frac": 0.5, "max_trades_per_day": 50,
        "kill_switch_file": str(tmp / "KILL"),
        "asset_buckets": {"ETH": "crypto", "BTC": "crypto"},
        "exposure_caps": {"crypto": 0.6},   # 60% of 100k equity = 60k cap
    }})
    # 50k held + 20k new = 70k > 60k cap -> blocked
    d = rm.check(20000, 20000, strategy="s2", market="I-BTC_INR", increasing=True)
    assert not d.ok and "BUCKET_EXPOSURE_CAP" in d.reason, d.reason
    # 50k held + 5k new = 55k <= 60k -> passes
    assert rm.check(5000, 5000, strategy="s2", market="I-BTC_INR", increasing=True).ok
    # unmapped asset -> no bucket cap applies
    assert rm.check(20000, 20000, strategy="s3", market="I-SOL_INR", increasing=True).ok
    # closing sells never blocked
    assert rm.check(50000, 0, strategy="s1", market="I-ETH_INR", increasing=False).ok
    audit.set_position("s1", "I-ETH_INR", 0.0, 0.0, 0.0, 0)


def test_btc_overlay_blocks_entries(tmp: Path) -> None:
    """BTC under its 100d line -> entry multiplier 0 -> no BUY placed; BTC above ->
    entries proceed. Overlay fails OPEN when the BTC feed is unusable."""
    eng, fake = _fresh(tmp, portfolio={"btc_regime_filter": {
        "enabled": True, "market": "I-BTC_INR", "period": 100, "entry_mult": 0.0}})
    eng.btc_filter = dict(eng.cfg["portfolio"]["btc_regime_filter"])

    falling_btc = _healthy_bars(400, price=200.0, rising=False)
    cache: dict = {("I-BTC_INR", "1d"): falling_btc}
    assert eng._overlay_mult(cache) == 0.0, "falling BTC must zero the entry mult"

    rising_btc = _healthy_bars(400, price=100.0, rising=True)
    cache = {("I-BTC_INR", "1d"): rising_btc}
    assert eng._overlay_mult(cache) == 1.0, "rising BTC must leave entries unscaled"

    # fail-open: unusable/absent BTC feed -> 1.0
    cache = {("I-BTC_INR", "1d"): None}
    assert eng._overlay_mult(cache) == 1.0
    cache = {("I-BTC_INR", "1d"): _healthy_bars(20)}
    assert eng._overlay_mult(cache) == 1.0, "insufficient history must fail open"

    # disabled filter is a strict no-op
    eng.btc_filter = {}
    assert eng._overlay_mult({}) == 1.0


def test_vol_target_mult(tmp: Path) -> None:
    eng, _ = _fresh(tmp)

    class S:
        vol_target_ann = 0.40

    flat = _healthy_bars(50, price=100.0)          # ~0 vol -> full size
    assert eng._vol_target_mult(S(), flat) == 1.0
    # violent series: alternating +/-10% days -> realized vol >> 40% -> scaled down
    wild = []
    px = 100.0
    now = int(_time.time() * 1000)
    for i in range(50):
        px *= 1.10 if i % 2 == 0 else 0.90
        wild.append({"time": now - (50 - i) * DAY, "open": px, "high": px, "low": px,
                     "close": px, "volume": 1.0})
    m = eng._vol_target_mult(S(), wild)
    assert 0.0 < m < 0.5, ("extreme vol must materially shrink the entry", m)

    class Off:
        vol_target_ann = 0.0

    assert eng._vol_target_mult(Off(), wild) == 1.0, "0 = disabled"


def test_sleeve_derisk_mult(tmp: Path) -> None:
    from . import audit, sizing

    eng, _ = _fresh(tmp)
    sizing._cfg_cache["risk"]["sleeve_drawdown_derisk_frac"] = 0.05
    sizing._cfg_cache["risk"]["sleeve_drawdown_derisk_mult"] = 0.5
    try:
        # sleeve made +1000 then lost 900: dd=900 vs 5% of sleeve notional
        # (0.139*100000 ~ 13900 -> threshold 695) -> derisked
        audit.log_order({"client_order_id": "p1", "strategy": "sv", "market": "I-ETH_INR",
                         "side": "sell", "qty": 1, "price": 100, "notional": 100,
                         "status": "dry_run", "dry_run": True, "realized_pnl": 1000.0})
        assert sizing.sleeve_derisk_mult("sv", 0.139) == 1.0, "at its peak: full size"
        audit.log_order({"client_order_id": "p2", "strategy": "sv", "market": "I-ETH_INR",
                         "side": "sell", "qty": 1, "price": 100, "notional": 100,
                         "status": "dry_run", "dry_run": True, "realized_pnl": -900.0})
        assert sizing.sleeve_derisk_mult("sv", 0.139) == 0.5, "in drawdown: half size"
        # disabled -> always 1.0
        sizing._cfg_cache["risk"]["sleeve_drawdown_derisk_frac"] = 0.0
        assert sizing.sleeve_derisk_mult("sv", 0.139) == 1.0
    finally:
        sizing._cfg_cache["risk"].pop("sleeve_drawdown_derisk_frac", None)
        sizing._cfg_cache["risk"].pop("sleeve_drawdown_derisk_mult", None)


def test_engine_cooldown_and_slippage_cap(tmp: Path) -> None:
    from . import audit

    eng, fake = _fresh(tmp)
    strat = eng.strategies[0]
    strat.reentry_cooldown_bars = 3
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw) or {"status": "dry_run"}

    # a healthy rising feed that makes tsmom BUY (strong momentum near its high)
    bars = _healthy_bars(400, price=100.0, rising=True)
    fake.candles_data = bars
    ts = bars[-2]["time"]  # last CLOSED bar
    # cooldown recorded until 3 bars after ts -> BUY must be skipped
    audit.set_cooldown_until(strat.name, strat.market, ts + 3 * DAY)
    eng.run_once()
    assert not placed, "cooldown must block the BUY"
    # cooldown expired -> BUY goes through
    audit.set_cooldown_until(strat.name, strat.market, ts)
    eng.run_once()
    assert placed and placed[0]["side"] == "buy", "expired cooldown must allow the BUY"

    # slippage cap: in-progress bar price ran 5% above the signal close -> skip
    placed.clear()
    audit.set_cooldown_until(strat.name, strat.market, 0)
    strat.reentry_cooldown_bars = 0
    strat.entry_slippage_cap_pct = 0.03
    ran_away = [dict(b) for b in bars]
    ran_away[-1] = {**ran_away[-1], "close": ran_away[-2]["close"] * 1.05,
                    "high": ran_away[-2]["close"] * 1.06}
    fake.candles_data = ran_away
    eng.run_once()
    assert not placed, "entry must be skipped when live price ran past the cap"
    strat.entry_slippage_cap_pct = 0.0
    eng.run_once()
    assert placed, "cap off -> entry proceeds"


def test_stuck_error_row_retry(tmp: Path) -> None:
    """A protective exit whose POST errored occupies the idempotency key; the retry on
    the same bar resolves it against the exchange and, on 'never landed', re-places."""
    from . import audit, config, sizing
    from .client import CoinDCXError

    eng, fake = _fresh(tmp)
    old_live = config.LIVE
    config.LIVE = True
    try:
        audit.set_position("tsmom_test", "I-ETH_INR", 1.0, 200.0, 210.0, 1000)
        fake.create_raises = CoinDCXError("network error: timeout")
        r1 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                qty=1.0, price=190.0, candle_ts=9000)
        assert r1["status"] == "error"
        coid = r1["client_order_id"]
        # same logical decision re-fired (same bar): exchange says the order never
        # landed -> the row is reconciled to 'rejected' and the retry goes through
        fake.create_raises = None
        fake.status_by_coid[coid] = None
        r2 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                qty=1.0, price=190.0, candle_ts=9000)
        assert r2["status"] == "placed", r2
        assert audit.get_position("tsmom_test", "I-ETH_INR")[0] == 0.0, "sell must book"
        assert audit.order_status_of(coid) == "placed", "row must be updated in place"

        # counter-case: the exchange DID fill the 'lost' attempt -> retry must NOT
        # re-place; the book is healed instead
        audit.set_position("tsmom_test", "I-ETH_INR", 1.0, 200.0, 210.0, 2000)
        fake.create_raises = CoinDCXError("network error: timeout")
        r3 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                qty=1.0, price=195.0, candle_ts=10000)
        fake.create_raises = None
        fake.status_by_coid[r3["client_order_id"]] = {"orders": [{
            "status": "filled", "filled_quantity": 1.0, "avg_price": 195.5}]}
        n_orders = len(fake.orders_placed)
        r4 = eng.executor.place(strategy="tsmom_test", market="I-ETH_INR", side="sell",
                                qty=1.0, price=195.0, candle_ts=10000)
        assert r4["status"] == "skipped" and r4["reason"] == "resolved", r4
        assert len(fake.orders_placed) == n_orders, "no duplicate order may be sent"
        assert audit.get_position("tsmom_test", "I-ETH_INR")[0] == 0.0, "healed to flat"
    finally:
        config.LIVE = old_live
        _ = sizing


def test_engine_ladder_exit(tmp: Path) -> None:
    from . import audit

    eng, fake = _fresh(tmp)
    strat = eng.strategies[0]
    strat.chandelier_k = 0.0
    strat.exit_ladder_frac = 0.5
    strat.exit_ladder_k = 1.0
    strat.exit_atr_period = 3
    placed: list = []
    eng.executor.place = lambda **kw: placed.append(kw) or {"status": "dry_run"}

    closed = _healthy_bars(60, price=100.0, rising=True)
    price = closed[-1]["close"]
    peak = price * 1.5  # fell hard off the peak -> ladder trips
    assert eng._ladder_exit(strat, closed, price, 2.0, peak, entry_ts=777)
    assert placed and placed[0]["side"] == "sell" and abs(placed[0]["qty"] - 1.0) < 1e-9
    # fires once per position
    assert not eng._ladder_exit(strat, closed, price, 1.0, peak, entry_ts=777)
    # a NEW position (different entry_ts) can ladder again
    assert eng._ladder_exit(strat, closed, price, 1.0, peak, entry_ts=888)
    # disabled or chandelier-carrying sleeves never ladder
    strat.exit_ladder_frac = 0.0
    assert not eng._ladder_exit(strat, closed, price, 1.0, peak, entry_ts=999)
    _ = audit, fake


def main() -> None:
    tests = [test_risk_new_entry_cap, test_risk_consecutive_loss_halt,
             test_risk_bucket_exposure_cap, test_btc_overlay_blocks_entries,
             test_vol_target_mult, test_sleeve_derisk_mult,
             test_engine_cooldown_and_slippage_cap, test_stuck_error_row_retry,
             test_engine_ladder_exit]
    for fn in tests:
        with tempfile.TemporaryDirectory(prefix="pfeat_") as d:
            fn(Path(d))
    print("portfolio-feature self-checks OK: entry cap, consecutive-loss halt, bucket "
          "exposure cap, BTC overlay, vol targeting, sleeve derisk, cooldown + slippage "
          "cap, stuck-order retry, partial-exit ladder")


if __name__ == "__main__":
    main()
