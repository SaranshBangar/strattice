// Client-safe walk-forward simulator for the strategy templates. Ports the ENTRY logic
// from bot/strategies/*.py and the protective EXIT layer the engine runs (hard stop /
// take-profit / ATR chandelier trail / time-stop), using the stock per-template params
// from worker/config_gen.py TEMPLATE_DEFAULTS. Purpose: show users where a strategy
// would have entered and exited on real candles BEFORE they add it. It is a preview,
// not the accounting-grade backtester (bot/backtest.py) - fills at bar close, long-only.

import type { Template } from "./entitlements";

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export interface SimTrade {
  entryIdx: number;
  exitIdx: number | null; // null = still open at the end of the window
  entryPrice: number;
  exitPrice: number; // last close if still open
  grossPct: number; // % move, before friction
  netPct: number; // after ~1.47% round-trip friction (fee+GST both sides, 1% TDS on sell)
  reason: "stop" | "target" | "trail" | "time" | "open";
}

export interface SimResult {
  trades: SimTrade[];
  closed: number;
  wins: number; // closed trades with netPct > 0
  winRate: number | null; // null when no closed trades
  totalNetPct: number; // compounded net return across closed trades
  buyHoldPct: number; // first close -> last close, for comparison
  exposurePct: number; // % of bars spent in a position
}

// Round-trip friction: 0.2% fee + 18% GST each side (0.236% x2) + 1% TDS on the sell.
export const FRICTION_PCT = 1.47;

// ---------- per-template config (mirrors worker/config_gen.py TEMPLATE_DEFAULTS) ----------

export interface ExitConfig {
  stopLossPct: number; // hard stop, fraction (0.04 = 4%)
  takeProfitPct: number; // 0 = none
  chandelierK: number; // 0 = no trail
  atrPeriod: number;
  maxHoldBars: number; // 0 = no time-stop
}

export interface TemplateConfig {
  market: string; // default market
  exits: ExitConfig;
  params: Record<string, number>;
  /** Human labels for the params worth surfacing, in display order. */
  paramLabels: [key: string, label: string][];
}

export const TEMPLATE_CONFIG: Record<Template, TemplateConfig> = {
  ma_crossover: {
    market: "I-BTC_INR",
    exits: { stopLossPct: 0.04, takeProfitPct: 0, chandelierK: 3.0, atrPeriod: 16, maxHoldBars: 0 },
    params: { fast: 32, slow: 96, atr_period: 16, k_atr: 0.5, confirm_bars: 4, regime_period: 192, expected_move_pct: 0.05 },
    paramLabels: [
      ["fast", "Fast SMA period"],
      ["slow", "Slow SMA period"],
      ["k_atr", "Min gap (× ATR)"],
      ["confirm_bars", "Cross freshness (bars)"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  rsi: {
    market: "I-ETH_INR",
    exits: { stopLossPct: 0.03, takeProfitPct: 0.03, chandelierK: 0, atrPeriod: 16, maxHoldBars: 64 },
    params: { period: 14, oversold: 22, regime_period: 192, expected_move_pct: 0.05 },
    paramLabels: [
      ["period", "RSI period"],
      ["oversold", "Oversold threshold"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  momentum: {
    market: "I-BTC_INR",
    exits: { stopLossPct: 0.04, takeProfitPct: 0, chandelierK: 3.0, atrPeriod: 16, maxHoldBars: 0 },
    params: { lookback: 32, atr_period: 16, vol_period: 32, min_atr_frac: 0.005, vol_mult: 1.2, buffer: 0.002, max_chase: 0.02, regime_period: 96, expected_move_pct: 0.03 },
    paramLabels: [
      ["lookback", "Breakout lookback (bars)"],
      ["buffer", "Entry buffer (frac)"],
      ["max_chase", "Chase cap (frac)"],
      ["vol_mult", "Volume multiple"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  vol_expansion: {
    market: "I-XRP_INR",
    exits: { stopLossPct: 0.025, takeProfitPct: 0, chandelierK: 2.5, atrPeriod: 16, maxHoldBars: 0 },
    params: { short_atr: 8, long_atr: 32, expansion_mult: 1.6, breakout_lookback: 24, regime_period: 96, expected_move_pct: 0.03 },
    paramLabels: [
      ["short_atr", "Short ATR period"],
      ["long_atr", "Long ATR period"],
      ["expansion_mult", "Expansion multiple"],
      ["breakout_lookback", "New-high lookback (bars)"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  fast_rsi: {
    market: "I-BNB_INR",
    exits: { stopLossPct: 0.02, takeProfitPct: 0.025, chandelierK: 0, atrPeriod: 16, maxHoldBars: 12 },
    params: { period: 7, oversold: 25, regime_period: 96, expected_move_pct: 0.03 },
    paramLabels: [
      ["period", "RSI period"],
      ["oversold", "Oversold threshold"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  bb_reversion: {
    market: "I-SOL_INR",
    exits: { stopLossPct: 0.03, takeProfitPct: 0.04, chandelierK: 0, atrPeriod: 16, maxHoldBars: 32 },
    params: { period: 20, k: 2.0, z_entry: 2.0, regime_period: 96, expected_move_pct: 0.03 },
    paramLabels: [
      ["period", "Bollinger period"],
      ["k", "Band width (σ)"],
      ["z_entry", "Min dislocation (σ)"],
      ["regime_period", "Regime SMA period"],
    ],
  },
  squeeze_breakout: {
    market: "I-DOGE_INR",
    exits: { stopLossPct: 0.04, takeProfitPct: 0, chandelierK: 3.0, atrPeriod: 16, maxHoldBars: 0 },
    params: { bb_period: 20, k_bb: 2.0, k_kc: 1.5, atr_period: 16, lookback: 20, squeeze_lookback: 6, vol_period: 32, vol_mult: 1.2, buffer: 0.002, max_chase: 0.02, min_atr_frac: 0.005, regime_period: 96, expected_move_pct: 0.03 },
    paramLabels: [
      ["bb_period", "Bollinger period"],
      ["k_kc", "Keltner width (× ATR)"],
      ["squeeze_lookback", "Squeeze window (bars)"],
      ["lookback", "Breakout lookback (bars)"],
      ["vol_mult", "Volume multiple"],
      ["regime_period", "Regime SMA period"],
    ],
  },
};

// ---------- indicators (match bot/strategies/base.py exactly) ----------

/** SMA of the last n values of `values[0..end]` (end inclusive). */
function sma(values: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += values[i];
  return s / n;
}

/** Population stdev of the last n values ending at `end`. */
function stdev(values: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let m = 0;
  for (let i = end - n + 1; i <= end; i++) m += values[i];
  m /= n;
  let v = 0;
  for (let i = end - n + 1; i <= end; i++) v += (values[i] - m) ** 2;
  return Math.sqrt(v / n);
}

/** ATR over the last n bars ending at `end` (Wilder TR, simple mean - same as the bot). */
function atr(candles: Candle[], end: number, n: number): number | null {
  if (end < n) return null; // needs n TRs, each needing a previous close
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const h = candles[i].h, l = candles[i].l, pc = candles[i - 1].c;
    s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return s / n;
}

/** Simple (non-Wilder-smoothed) RSI over the last n deltas ending at `end` - same as the bot. */
function rsi(closes: number[], end: number, n: number): number | null {
  if (end < n) return null;
  let gains = 0, losses = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / n / (losses / n);
  return 100 - 100 / (1 + rs);
}

function avgVolume(candles: Candle[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += candles[i].v;
  return s / n;
}

/** Shared regime gate: close above its regime-period SMA. */
function uptrend(closes: number[], end: number, regimePeriod: number): boolean {
  if (end + 1 < regimePeriod + 1) return false;
  const ma = sma(closes, end, regimePeriod);
  return ma !== null && closes[end] > ma;
}

// ---------- entry logic per template (ports of bot/strategies/*.py decide()) ----------

type EntryFn = (candles: Candle[], closes: number[], end: number, p: Record<string, number>) => boolean;

const maCrossoverEntry: EntryFn = (candles, closes, end, p) => {
  const { fast, slow, atr_period, k_atr, confirm_bars, regime_period } = p;
  if (end + 1 < Math.max(slow + 2, atr_period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const prevS = sma(closes, end - 1, slow);
  const f = sma(closes, end, fast);
  const s = sma(closes, end, slow);
  const a = atr(candles, end, atr_period);
  if (prevS === null || f === null || s === null || a === null) return false;
  if (f - s < k_atr * a) return false; // separation gap
  if (s <= prevS) return false; // slow MA must be rising
  // cross must be fresh: fast crossed above slow within the last confirm_bars
  for (let j = 0; j < confirm_bars; j++) {
    const e = end - j;
    if (e < 1) break;
    const af = sma(closes, e, fast), as = sma(closes, e, slow);
    const bf = sma(closes, e - 1, fast), bs = sma(closes, e - 1, slow);
    if (af !== null && as !== null && bf !== null && bs !== null && bf <= bs && af > as) return true;
  }
  return false;
};

const rsiEntry: EntryFn = (candles, closes, end, p) => {
  const { period, oversold, regime_period } = p;
  if (end + 1 < Math.max(period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const r = rsi(closes, end, period);
  if (r === null || r >= oversold) return false;
  // confirmation: current close back above the prior bar's high
  return candles[end].c > candles[end - 1].h;
};

const momentumEntry: EntryFn = (candles, closes, end, p) => {
  const { lookback, atr_period, vol_period, min_atr_frac, vol_mult, buffer, max_chase, regime_period } = p;
  if (end + 1 < Math.max(lookback + 1, atr_period + 1, vol_period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  let windowHigh = 0;
  for (let i = end - lookback; i < end; i++) windowHigh = Math.max(windowHigh, candles[i].h);
  const a = atr(candles, end, atr_period);
  const av = avgVolume(candles, end - 1, vol_period);
  if (a === null || av === null || windowHigh <= 0) return false;
  const price = candles[end].c;
  if (a < min_atr_frac * price) return false; // volatility floor
  if (candles[end].v < vol_mult * av) return false; // volume confirmation
  if (price < windowHigh * (1 + buffer)) return false; // break + buffer
  if (price > windowHigh * (1 + max_chase)) return false; // chase cap
  return true;
};

const volExpansionEntry: EntryFn = (candles, closes, end, p) => {
  const { short_atr, long_atr, expansion_mult, breakout_lookback, regime_period } = p;
  if (end + 1 < Math.max(long_atr + 1, breakout_lookback + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const aShort = atr(candles, end, short_atr);
  const aLong = atr(candles, end, long_atr);
  if (aShort === null || aLong === null || aLong <= 0) return false;
  if (aShort < expansion_mult * aLong) return false; // require a volatility pop
  let hi = -Infinity;
  for (let i = end - breakout_lookback; i < end; i++) hi = Math.max(hi, closes[i]);
  return closes[end] >= hi; // new local closing high
};

const bbReversionEntry: EntryFn = (candles, closes, end, p) => {
  const { period, k, z_entry, regime_period } = p;
  if (end + 1 < Math.max(period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const mid = sma(closes, end, period), sd = stdev(closes, end, period);
  const prevMid = sma(closes, end - 1, period), prevSd = stdev(closes, end - 1, period);
  if (mid === null || sd === null || prevMid === null || prevSd === null || sd <= 0 || prevSd <= 0) return false;
  const lower = mid - k * sd;
  const prevLower = prevMid - k * prevSd;
  const prevClose = closes[end - 1];
  // prior bar: a >= z_entry-sigma stretch that closed at/below its lower band
  if (!(prevClose <= prevLower && (prevMid - prevClose) / prevSd >= z_entry)) return false;
  // current bar: snapped back inside the band (don't catch the knife)
  return closes[end] > lower;
};

const squeezeBreakoutEntry: EntryFn = (candles, closes, end, p) => {
  const { bb_period, k_bb, k_kc, atr_period, lookback, squeeze_lookback, vol_period, vol_mult, buffer, max_chase, min_atr_frac, regime_period } = p;
  if (end + 1 < Math.max(lookback + 1, bb_period + 1, atr_period + 1, vol_period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const price = closes[end];
  const a = atr(candles, end, atr_period);
  if (a === null || a < min_atr_frac * price) return false; // vol floor
  // squeeze must have fired within the recent window (compression precedes expansion)
  let wasSqueezed = false;
  for (let j = 1; j <= squeeze_lookback; j++) {
    const e = end - j;
    if (e < 0) break;
    const sd = stdev(closes, e, bb_period);
    const ka = atr(candles, e, atr_period);
    if (sd !== null && ka !== null && k_bb * sd < k_kc * ka) { wasSqueezed = true; break; }
  }
  if (!wasSqueezed) return false;
  let windowHigh = 0;
  for (let i = end - lookback; i < end; i++) windowHigh = Math.max(windowHigh, candles[i].h);
  if (windowHigh <= 0) return false;
  if (price < windowHigh * (1 + buffer)) return false;
  if (price > windowHigh * (1 + max_chase)) return false;
  const av = avgVolume(candles, end - 1, vol_period);
  return av !== null && candles[end].v >= vol_mult * av;
};

const ENTRY: Record<Template, EntryFn> = {
  ma_crossover: maCrossoverEntry,
  rsi: rsiEntry,
  momentum: momentumEntry,
  vol_expansion: volExpansionEntry,
  fast_rsi: rsiEntry, // same rule as rsi, different stock params
  bb_reversion: bbReversionEntry,
  squeeze_breakout: squeezeBreakoutEntry,
};

// ---------- walk-forward simulation ----------

/** Replay the template over the candles: enter on the entry rule when flat, exit via the
 *  engine's protective layer (checked on each bar's close, same as the live poll loop). */
export function simulate(template: Template, candles: Candle[]): SimResult {
  const cfg = TEMPLATE_CONFIG[template];
  const entryFn = ENTRY[template];
  const closes = candles.map((c) => c.c);
  const { stopLossPct, takeProfitPct, chandelierK, atrPeriod, maxHoldBars } = cfg.exits;

  const trades: SimTrade[] = [];
  let inPos = false;
  let entryIdx = 0, entryPrice = 0, peak = 0;
  let barsInPos = 0;

  for (let i = 1; i < candles.length; i++) {
    const close = closes[i];
    if (inPos) {
      peak = Math.max(peak, close);
      let reason: SimTrade["reason"] | null = null;
      if (close <= entryPrice * (1 - stopLossPct)) reason = "stop";
      else if (takeProfitPct > 0 && close >= entryPrice * (1 + takeProfitPct)) reason = "target";
      else if (chandelierK > 0) {
        const a = atr(candles, i, atrPeriod);
        if (a !== null && close <= peak - chandelierK * a) reason = "trail";
      }
      if (!reason && maxHoldBars > 0 && i - entryIdx >= maxHoldBars) reason = "time";
      if (reason) {
        const grossPct = ((close - entryPrice) / entryPrice) * 100;
        trades.push({ entryIdx, exitIdx: i, entryPrice, exitPrice: close, grossPct, netPct: grossPct - FRICTION_PCT, reason });
        inPos = false;
      } else {
        barsInPos++;
      }
    } else if (entryFn(candles, closes, i, cfg.params)) {
      inPos = true;
      entryIdx = i;
      entryPrice = close;
      peak = close;
      barsInPos++;
    }
  }

  if (inPos) {
    const last = closes[closes.length - 1];
    const grossPct = ((last - entryPrice) / entryPrice) * 100;
    trades.push({ entryIdx, exitIdx: null, entryPrice, exitPrice: last, grossPct, netPct: grossPct - FRICTION_PCT, reason: "open" });
  }

  const closedTrades = trades.filter((t) => t.exitIdx !== null);
  const wins = closedTrades.filter((t) => t.netPct > 0).length;
  const totalNetPct = (closedTrades.reduce((eq, t) => eq * (1 + t.netPct / 100), 1) - 1) * 100;
  const buyHoldPct = closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;

  return {
    trades,
    closed: closedTrades.length,
    wins,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : null,
    totalNetPct,
    buyHoldPct,
    exposurePct: candles.length > 1 ? (barsInPos / (candles.length - 1)) * 100 : 0,
  };
}

// ---------- indicator overlays for the preview chart ----------

export interface OverlaySeries {
  name: string;
  /** One value per candle; null while the indicator is warming up. */
  points: (number | null)[];
  /** "primary" = template-specific level (accent), "secondary" = context line (dim). */
  role: "primary" | "secondary";
}

function smaSeries(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) => sma(closes, i, n));
}

/** Highest of the PREVIOUS `lookback` bars (excl current) - the Donchian entry level. */
function priorHighSeries(values: number[], lookback: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < lookback) return null;
    let hi = -Infinity;
    for (let j = i - lookback; j < i; j++) hi = Math.max(hi, values[j]);
    return hi;
  });
}

/** The price levels each template actually watches, so the chart explains the entries. */
export function overlays(template: Template, candles: Candle[]): OverlaySeries[] {
  const p = TEMPLATE_CONFIG[template].params;
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const regime: OverlaySeries = {
    name: `Regime SMA(${p.regime_period})`,
    points: smaSeries(closes, p.regime_period),
    role: "secondary",
  };
  switch (template) {
    case "ma_crossover":
      return [
        { name: `SMA(${p.fast})`, points: smaSeries(closes, p.fast), role: "primary" },
        { name: `SMA(${p.slow})`, points: smaSeries(closes, p.slow), role: "secondary" },
      ];
    case "momentum":
      return [{ name: `${p.lookback}-bar high`, points: priorHighSeries(highs, p.lookback), role: "primary" }, regime];
    case "squeeze_breakout":
      return [{ name: `${p.lookback}-bar high`, points: priorHighSeries(highs, p.lookback), role: "primary" }, regime];
    case "vol_expansion":
      return [{ name: `${p.breakout_lookback}-bar close high`, points: priorHighSeries(closes, p.breakout_lookback), role: "primary" }, regime];
    case "bb_reversion": {
      const upper = closes.map((_, i) => {
        const m = sma(closes, i, p.period), sd = stdev(closes, i, p.period);
        return m !== null && sd !== null ? m + p.k * sd : null;
      });
      const lower = closes.map((_, i) => {
        const m = sma(closes, i, p.period), sd = stdev(closes, i, p.period);
        return m !== null && sd !== null ? m - p.k * sd : null;
      });
      return [
        { name: `BB upper (${p.k}σ)`, points: upper, role: "primary" },
        { name: `BB lower (${p.k}σ)`, points: lower, role: "primary" },
        regime,
      ];
    }
    case "rsi":
    case "fast_rsi":
      return [regime];
  }
}

export const EXIT_REASON_LABEL: Record<SimTrade["reason"], string> = {
  stop: "hard stop",
  target: "take-profit",
  trail: "ATR trail",
  time: "time-stop",
  open: "still open",
};
