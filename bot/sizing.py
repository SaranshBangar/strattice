"""Wallet-scaled position sizing (constraint B) — replaces fixed-$ sizing.

Positions scale with equity so a $1k and a $5k wallet both deploy near-full, proportionally.
The no-leverage invariant (total deployed <= free balance) is enforced in risk.py; here we
size a single entry to fit the wallet with fee headroom and the pair's min-notional floor.

Two sources of truth for money:
  LIVE     -> real free USDT from the exchange.
  DRY_RUN  -> simulated = starting_equity (config) + all realized P&L (audit);
              free = that minus the cost basis of open positions. NEVER reads live balance.
"""
import math

from . import audit, config, costs
from .client import Client

_cfg_cache: dict | None = None
_client: Client | None = None


def _cfg() -> dict:
    global _cfg_cache
    if _cfg_cache is None:
        _cfg_cache = config.load()
    return _cfg_cache


def _live_client(client: Client | None) -> Client:
    global _client
    if client is not None:
        return client
    if _client is None:
        _client = Client()
    return _client


def allocation_frac() -> float:
    return float(_cfg().get("allocation_frac", 0.97))


def sleeve_fracs(cfg: dict | None = None) -> dict[str, float]:
    """Per-strategy capital sleeves so strategies can hold positions CONCURRENTLY.

    LIMITATION THIS REPLACES: there was ONE global allocation_frac, and target_qty deployed
    allocation_frac*equity capped by free balance. The first strategy to fire consumed ~97% of
    the wallet, so any second concurrent strategy sized to ~0 (below min-notional). True
    multi-strategy concurrency was NOT supported.

    Model: each ENABLED strategy declares a relative `weight` (default 1.0 => equal split). Its
    sleeve = allocation_frac * weight / sum(weights). Normalizing to allocation_frac makes
    `sum(sleeves) == allocation_frac <= 1.0` hold BY CONSTRUCTION, so no config typo can breach the
    no-leverage cap. Sizing still caps each entry by remaining free balance (see target_qty), and
    risk.check() is the final backstop."""
    c = cfg if cfg is not None else _cfg()
    cap = float(c.get("allocation_frac", allocation_frac()))
    enabled = [s for s in c.get("strategies", []) if s.get("enabled", True)]
    weights = {s["name"]: float(s.get("weight", 1.0)) for s in enabled}
    total = sum(weights.values())
    if total <= 0:
        return {n: 0.0 for n in weights}
    return {n: cap * w / total for n, w in weights.items()}


def sleeve_too_small(sleeve_frac: float, eq: float, min_notional: float) -> bool:
    """True if a sleeve's full-size notional is below the pair's exchange minimum, so it can
    never place a valid order. Surfaced as a startup WARNING (engine._sanity_check), never an
    order — the executor independently skips sub-min-notional fills."""
    return min_notional > 0 and sleeve_frac * eq < min_notional


def quote_currency() -> str:
    """Wallet currency the bot sizes/trades in. Must match the quote side of every
    strategy's market (e.g. USDT for *_USDT pairs, INR for *_INR pairs)."""
    return str(_cfg().get("quote_currency", "USDT"))


def equity(client: Client | None = None) -> float:
    """Total net worth in the quote currency. Open positions marked at cost (avg)."""
    if config.LIVE:
        c = _live_client(client)
        return c.free_balance(quote_currency()) + audit.today_stats()["capital_at_risk"]
    return float(_cfg().get("starting_equity", 1000.0)) + audit.total_realized()


def free_balance(client: Client | None = None) -> float:
    """Uninvested cash available to deploy (quote currency)."""
    if config.LIVE:
        return _live_client(client).free_balance(quote_currency())
    return equity() - audit.today_stats()["capital_at_risk"]


def drawdown(client: Client | None = None) -> float:
    """Current equity drawdown from the all-time high-water-mark, as a fraction in [0, 1].

    Side effect: bumps the persisted HWM (monotonic) to the current equity, so the peak
    always reflects the best equity ever reached even across restarts. Realized-basis, matching
    equity() - open positions are marked at cost, so an unrealized loss only shows up here once
    the position is closed (same basis as the daily-loss breaker in risk.py)."""
    eq = equity(client)
    peak = audit.bump_equity_peak(eq)
    if peak <= 0:
        return 0.0
    return max(0.0, (peak - eq) / peak)


def derisk_mult(client: Client | None = None) -> float:
    """Position-size multiplier from the drawdown auto-derisk ladder (constraint D):
        dd < derisk band          -> 1.0  (full size)
        derisk <= dd < kill band  -> drawdown_derisk_mult   (e.g. 0.5 = half size)
        dd >= kill band           -> 0.0  (no new size; risk.check() also hard-blocks)
    Disabled (returns 1.0) when drawdown_derisk_frac is unset or <= 0, so the default engine
    behaviour is unchanged. See config.yaml risk.drawdown_*."""
    r = _cfg().get("risk", {})
    warn = float(r.get("drawdown_derisk_frac", 0.0) or 0.0)
    if warn <= 0:
        return 1.0
    kill = float(r.get("drawdown_kill_frac", 0.0) or 0.0)
    mult = float(r.get("drawdown_derisk_mult", 0.5))
    dd = drawdown(client)
    if kill > 0 and dd >= kill:
        return 0.0
    if dd >= warn:
        return max(0.0, min(1.0, mult))
    return 1.0


def sleeve_derisk_mult(strategy_name: str, sleeve_frac: float,
                       client: Client | None = None) -> float:
    """Per-SLEEVE drawdown auto-derisk (risk.sleeve_drawdown_derisk_frac, 0 = off, the
    default). Realized-basis like the global ladder: when a sleeve's cumulative realized
    P&L sits more than frac * its current sleeve notional below its own all-time peak,
    its NEW entries are scaled by sleeve_drawdown_derisk_mult. Protective exits are
    never touched. Complements the GLOBAL drawdown ladder (drawdown_derisk_frac), which
    reacts only to whole-account drawdown."""
    r = _cfg().get("risk", {})
    warn = float(r.get("sleeve_drawdown_derisk_frac", 0.0) or 0.0)
    if warn <= 0 or sleeve_frac <= 0:
        return 1.0
    mult = float(r.get("sleeve_drawdown_derisk_mult", 0.5))
    cum = audit.strategy_realized(strategy_name)
    peak = audit.bump_sleeve_peak(strategy_name, cum)
    sleeve_notional = sleeve_frac * equity(client)
    if sleeve_notional > 0 and (peak - cum) >= warn * sleeve_notional:
        return max(0.0, min(1.0, mult))
    return 1.0


def _floor_qty(client: Client, market: str, qty: float) -> float:
    """Round DOWN to the pair's step/precision so notional never exceeds balance."""
    m = client.markets().get(market)
    prec = int(m.get("target_currency_precision", 8)) if m else 8
    f = 10 ** prec
    return math.floor(qty * f) / f


def target_qty(market: str, price: float, client: Client | None = None,
               sleeve_frac: float | None = None, size_mult: float = 1.0) -> float:
    """Quantity to BUY: `sleeve_frac` of equity (this strategy's capital sleeve), capped by
    fee-adjusted free balance, floored to precision, and zeroed if below the pair's min-notional.

    sleeve_frac=None falls back to the global allocation_frac (single-strategy / backtest path).
    size_mult scales the target notional DOWN (clamped to [0,1]) - the engine passes the
    product of its portfolio overlays (BTC regime filter, vol targeting, sleeve derisk);
    1.0 = plain full-sleeve sizing.
    NO-LEVERAGE: free_balance() already nets out the cost basis of OTHER open positions, so a run
    of concurrent fills can never sum past free balance; with normalized sleeves they also sum to
    <= allocation_frac*equity. risk.check() is the final backstop."""
    if price <= 0:
        return 0.0
    c = _live_client(client)
    p = costs.params()
    frac = allocation_frac() if sleeve_frac is None else sleeve_frac
    headroom = free_balance(c) / (1 + p["fee_rate"] * (1 + p["gst_on_fee"]))
    # Auto-derisk: shrink (or zero) the sleeve while in a drawdown band. mult == 1.0
    # when the feature is disabled, so this is a no-op by default.
    size_mult = max(0.0, min(1.0, size_mult))
    target_notional = min(frac * equity(c) * derisk_mult(c) * size_mult, headroom)
    if target_notional <= 0:
        return 0.0
    qty = _floor_qty(c, market, target_notional / price)
    notional = qty * price
    if notional <= 0:
        return 0.0
    min_n = c.min_notional(market)
    if min_n and notional < min_n:
        return 0.0  # too small to trade
    return qty
