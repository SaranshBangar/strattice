// Client-safe walk-forward simulator for the strategy templates. Ports the ENTRY logic
// from bot/strategies/*.py and the protective EXIT layer the engine runs (hard stop /
// take-profit / ATR chandelier trail / time-stop), using the stock per-template params
// from worker/config_gen.py TEMPLATE_DEFAULTS. Purpose: show users where a strategy
// would have entered and exited on real candles BEFORE they add it. It is a preview,
// not the accounting-grade backtester (bot/backtest.py) - fills at bar close, long-only.

import type {
  BuiltinTemplate,
  ExperimentalTemplate,
  PickableTemplate,
} from "./entitlements";

/** Every template this module holds a config for: simulable builtins (active +
 *  retired-legacy) plus the experimental config-display-only entries. */
export type SimTemplate = BuiltinTemplate | ExperimentalTemplate;

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

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

/** An entry parameter the user may customize, with hard bounds the server re-enforces. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  int?: boolean;
}

export interface TemplateConfig {
  market: string; // default market
  exits: ExitConfig;
  params: Record<string, number>;
  /** The params worth surfacing/editing, in display order. Everything else stays stock. */
  editable: ParamSpec[];
}

export const TEMPLATE_CONFIG: Record<SimTemplate, TemplateConfig> = {
  // ---- ACTIVE daily templates (stock params = the proven daily defaults from the
  // repo's config.yaml / research/FINDINGS.md; the engine trades 1d bars) ----

  // Time-series momentum @ ETH: +207.6% net (PF 2.58) on I-ETH_INR 2023-09..2026-07.
  tsmom: {
    market: "I-ETH_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      lookback: 30,
      min_return: 0.1,
      near_high_frac: 0.02,
      regime_period: 50,
      expected_move_pct: 0.08,
    },
    editable: [
      {
        key: "lookback",
        label: "Momentum lookback (bars)",
        min: 5,
        max: 200,
        step: 1,
        int: true,
      },
      {
        key: "min_return",
        label: "Min return (frac)",
        min: 0.02,
        max: 0.5,
        step: 0.01,
      },
      {
        key: "near_high_frac",
        label: "Max off-high (frac)",
        min: 0.005,
        max: 0.1,
        step: 0.005,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // Supertrend @ BTC: +94.6% net on I-BTC_INR (twin +21.8%); 7/7 INR pairs positive.
  supertrend: {
    market: "I-BTC_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      atr_period: 10,
      mult: 3.0,
      confirm_bars: 2,
      regime_period: 50,
      expected_move_pct: 0.08,
    },
    editable: [
      {
        key: "atr_period",
        label: "ATR period",
        min: 3,
        max: 50,
        step: 1,
        int: true,
      },
      { key: "mult", label: "Band width (× ATR)", min: 1, max: 6, step: 0.1 },
      {
        key: "confirm_bars",
        label: "Flip freshness (bars)",
        min: 1,
        max: 10,
        step: 1,
        int: true,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // EXPERIMENTAL - Hugging Face Chronos-2 forecast. Runs only in the bot's Python
  // engine (bot/strategies/hf_forecast.py); the browser cannot run the model, so
  // this entry exists for config display/param editing only - no ENTRY fn, no sim.
  hf_forecast: {
    market: "I-BTC_INR",
    exits: {
      stopLossPct: 0.05,
      takeProfitPct: 0.08,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 16,
    },
    params: {
      context: 512,
      horizon: 8,
      min_forecast_pct: 3.0,
      regime_period: 100,
      expected_move_pct: 0.06,
    },
    editable: [
      {
        key: "horizon",
        label: "Forecast horizon (bars)",
        min: 2,
        max: 24,
        step: 1,
        int: true,
      },
      {
        key: "min_forecast_pct",
        label: "Min forecast move (%)",
        min: 0.5,
        max: 10,
        step: 0.1,
      },
      {
        key: "context",
        label: "Context window (bars)",
        min: 64,
        max: 1024,
        step: 32,
        int: true,
      },
    ],
  },
  // MA cross @ XRP: +187.7% net (PF 2.25) on I-XRP_INR (twin +109.8%). 8/25 daily.
  ma_crossover: {
    market: "I-XRP_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      fast: 8,
      slow: 25,
      atr_period: 14,
      k_atr: 0.2,
      confirm_bars: 3,
      regime_period: 100,
      expected_move_pct: 0.08,
    },
    editable: [
      {
        key: "fast",
        label: "Fast SMA period",
        min: 2,
        max: 200,
        step: 1,
        int: true,
      },
      {
        key: "slow",
        label: "Slow SMA period",
        min: 5,
        max: 400,
        step: 1,
        int: true,
      },
      { key: "k_atr", label: "Min gap (× ATR)", min: 0, max: 3, step: 0.1 },
      {
        key: "confirm_bars",
        label: "Cross freshness (bars)",
        min: 1,
        max: 20,
        step: 1,
        int: true,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // ---- RETIRED templates (mean reversion loses net of India friction at every
  // tested altitude - research/FINDINGS.md). Kept ONLY so legacy rows still render
  // and simulate; not offered for new adds. Params are the historical 15m-era stock. ----
  rsi: {
    market: "I-ETH_INR",
    exits: {
      stopLossPct: 0.03,
      takeProfitPct: 0.03,
      chandelierK: 0,
      atrPeriod: 16,
      maxHoldBars: 64,
    },
    params: {
      period: 14,
      oversold: 22,
      regime_period: 192,
      expected_move_pct: 0.05,
    },
    editable: [
      {
        key: "period",
        label: "RSI period",
        min: 2,
        max: 50,
        step: 1,
        int: true,
      },
      {
        key: "oversold",
        label: "Oversold threshold",
        min: 5,
        max: 50,
        step: 1,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // Donchian breakout @ BTC: +108.7% net (PF 2.75) on I-BTC_INR (twin +9.2%).
  momentum: {
    market: "I-BTC_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      lookback: 20,
      atr_period: 14,
      vol_period: 20,
      min_atr_frac: 0.01,
      vol_mult: 1.0,
      buffer: 0.002,
      max_chase: 0.05,
      regime_period: 50,
      expected_move_pct: 0.08,
    },
    editable: [
      {
        key: "lookback",
        label: "Breakout lookback (bars)",
        min: 5,
        max: 200,
        step: 1,
        int: true,
      },
      {
        key: "buffer",
        label: "Entry buffer (frac)",
        min: 0,
        max: 0.02,
        step: 0.001,
      },
      {
        key: "max_chase",
        label: "Chase cap (frac)",
        min: 0.005,
        max: 0.1,
        step: 0.005,
      },
      {
        key: "vol_mult",
        label: "Volume multiple",
        min: 0.5,
        max: 5,
        step: 0.1,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // Volatility expansion @ BNB: +143.6% net (PF 2.75) on I-BNB_INR (twin +171.9%).
  vol_expansion: {
    market: "I-BNB_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      short_atr: 5,
      long_atr: 20,
      expansion_mult: 1.3,
      breakout_lookback: 10,
      regime_period: 50,
      expected_move_pct: 0.06,
    },
    editable: [
      {
        key: "short_atr",
        label: "Short ATR period",
        min: 2,
        max: 50,
        step: 1,
        int: true,
      },
      {
        key: "long_atr",
        label: "Long ATR period",
        min: 5,
        max: 200,
        step: 1,
        int: true,
      },
      {
        key: "expansion_mult",
        label: "Expansion multiple",
        min: 1,
        max: 4,
        step: 0.1,
      },
      {
        key: "breakout_lookback",
        label: "New-high lookback (bars)",
        min: 5,
        max: 100,
        step: 1,
        int: true,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  fast_rsi: {
    market: "I-BNB_INR",
    exits: {
      stopLossPct: 0.02,
      takeProfitPct: 0.025,
      chandelierK: 0,
      atrPeriod: 16,
      maxHoldBars: 12,
    },
    params: {
      period: 7,
      oversold: 25,
      regime_period: 96,
      expected_move_pct: 0.03,
    },
    editable: [
      {
        key: "period",
        label: "RSI period",
        min: 2,
        max: 50,
        step: 1,
        int: true,
      },
      {
        key: "oversold",
        label: "Oversold threshold",
        min: 5,
        max: 50,
        step: 1,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  bb_reversion: {
    market: "I-SOL_INR",
    exits: {
      stopLossPct: 0.03,
      takeProfitPct: 0.04,
      chandelierK: 0,
      atrPeriod: 16,
      maxHoldBars: 32,
    },
    params: {
      period: 20,
      k: 2.0,
      z_entry: 2.0,
      regime_period: 96,
      expected_move_pct: 0.03,
    },
    editable: [
      {
        key: "period",
        label: "Bollinger period",
        min: 5,
        max: 100,
        step: 1,
        int: true,
      },
      { key: "k", label: "Band width (σ)", min: 1, max: 4, step: 0.1 },
      {
        key: "z_entry",
        label: "Min dislocation (σ)",
        min: 0.5,
        max: 4,
        step: 0.1,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
  // TTM squeeze @ DOGE: +138.9% net (PF 2.85) on I-DOGE_INR (twin +36.5%);
  // 18/21 walk-forward folds positive - the best fold record of the study.
  squeeze_breakout: {
    market: "I-DOGE_INR",
    exits: {
      stopLossPct: 0.07,
      takeProfitPct: 0,
      chandelierK: 3.5,
      atrPeriod: 14,
      maxHoldBars: 0,
    },
    params: {
      bb_period: 20,
      k_bb: 2.0,
      k_kc: 1.5,
      atr_period: 14,
      lookback: 20,
      squeeze_lookback: 6,
      vol_period: 20,
      vol_mult: 1.0,
      buffer: 0.002,
      max_chase: 0.05,
      min_atr_frac: 0.01,
      regime_period: 50,
      expected_move_pct: 0.08,
    },
    editable: [
      {
        key: "bb_period",
        label: "Bollinger period",
        min: 5,
        max: 100,
        step: 1,
        int: true,
      },
      {
        key: "k_kc",
        label: "Keltner width (× ATR)",
        min: 0.5,
        max: 4,
        step: 0.1,
      },
      {
        key: "squeeze_lookback",
        label: "Squeeze window (bars)",
        min: 1,
        max: 30,
        step: 1,
        int: true,
      },
      {
        key: "lookback",
        label: "Breakout lookback (bars)",
        min: 5,
        max: 200,
        step: 1,
        int: true,
      },
      {
        key: "vol_mult",
        label: "Volume multiple",
        min: 0.5,
        max: 5,
        step: 0.1,
      },
      {
        key: "regime_period",
        label: "Regime SMA period",
        min: 10,
        max: 400,
        step: 1,
        int: true,
      },
    ],
  },
};

// ---------- indicators (match bot/strategies/base.py exactly) ----------

/** SMA of the last n values of `values[0..end]` (end inclusive). */
export function sma(values: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += values[i];
  return s / n;
}

/** Population stdev of the last n values ending at `end`. */
export function stdev(values: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let m = 0;
  for (let i = end - n + 1; i <= end; i++) m += values[i];
  m /= n;
  let v = 0;
  for (let i = end - n + 1; i <= end; i++) v += (values[i] - m) ** 2;
  return Math.sqrt(v / n);
}

/** ATR over the last n bars ending at `end` (Wilder TR, simple mean - same as the bot). */
export function atr(candles: Candle[], end: number, n: number): number | null {
  if (end < n) return null; // needs n TRs, each needing a previous close
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const h = candles[i].h,
      l = candles[i].l,
      pc = candles[i - 1].c;
    s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return s / n;
}

/** Simple (non-Wilder-smoothed) RSI over the last n deltas ending at `end` - same as the bot. */
export function rsi(closes: number[], end: number, n: number): number | null {
  if (end < n) return null;
  let gains = 0,
    losses = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / n / (losses / n);
  return 100 - 100 / (1 + rs);
}

export function avgVolume(
  candles: Candle[],
  end: number,
  n: number,
): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += candles[i].v;
  return s / n;
}

/** Shared regime gate: close above its regime-period SMA. */
export function uptrend(
  closes: number[],
  end: number,
  regimePeriod: number,
): boolean {
  if (end + 1 < regimePeriod + 1) return false;
  const ma = sma(closes, end, regimePeriod);
  return ma !== null && closes[end] > ma;
}

// ---------- entry logic per template (ports of bot/strategies/*.py decide()) ----------

export type EntryFn = (
  candles: Candle[],
  closes: number[],
  end: number,
  p: Record<string, number>,
) => boolean;

const maCrossoverEntry: EntryFn = (candles, closes, end, p) => {
  const { fast, slow, atr_period, k_atr, confirm_bars, regime_period } = p;
  if (end + 1 < Math.max(slow + 2, atr_period + 1, regime_period + 1))
    return false;
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
    const af = sma(closes, e, fast),
      as = sma(closes, e, slow);
    const bf = sma(closes, e - 1, fast),
      bs = sma(closes, e - 1, slow);
    if (
      af !== null &&
      as !== null &&
      bf !== null &&
      bs !== null &&
      bf <= bs &&
      af > as
    )
      return true;
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
  const {
    lookback,
    atr_period,
    vol_period,
    min_atr_frac,
    vol_mult,
    buffer,
    max_chase,
    regime_period,
  } = p;
  if (
    end + 1 <
    Math.max(lookback + 1, atr_period + 1, vol_period + 1, regime_period + 1)
  )
    return false;
  if (!uptrend(closes, end, regime_period)) return false;
  let windowHigh = 0;
  for (let i = end - lookback; i < end; i++)
    windowHigh = Math.max(windowHigh, candles[i].h);
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
  const {
    short_atr,
    long_atr,
    expansion_mult,
    breakout_lookback,
    regime_period,
  } = p;
  if (
    end + 1 <
    Math.max(long_atr + 1, breakout_lookback + 1, regime_period + 1)
  )
    return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const aShort = atr(candles, end, short_atr);
  const aLong = atr(candles, end, long_atr);
  if (aShort === null || aLong === null || aLong <= 0) return false;
  if (aShort < expansion_mult * aLong) return false; // require a volatility pop
  let hi = -Infinity;
  for (let i = end - breakout_lookback; i < end; i++)
    hi = Math.max(hi, closes[i]);
  return closes[end] >= hi; // new local closing high
};

const tsmomEntry: EntryFn = (candles, closes, end, p) => {
  const { lookback, min_return, near_high_frac, regime_period } = p;
  if (end + 1 < Math.max(lookback + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const base = closes[end - lookback];
  if (base <= 0) return false;
  if (closes[end] / base - 1 < min_return) return false; // momentum threshold
  let windowHigh = 0; // high of the last `lookback` bars INCLUDING the current one
  for (let i = end - lookback + 1; i <= end; i++)
    windowHigh = Math.max(windowHigh, candles[i].h);
  return closes[end] >= windowHigh * (1 - near_high_frac); // not rolling over
};

/** Per-bar supertrend state over candles[0..end]: +1 up, -1 down, 0 warming up.
 *  Exact port of bot/strategies/supertrend.py supertrend_states (ratcheting bands). */
export function supertrendStates(
  candles: Candle[],
  end: number,
  atrPeriod: number,
  mult: number,
): number[] {
  const states = new Array<number>(end + 1).fill(0);
  const trs: number[] = [];
  let upBand: number | null = null; // support in an uptrend
  let dnBand: number | null = null; // resistance in a downtrend
  let state = 0;
  for (let i = 0; i <= end; i++) {
    let a: number | null = null;
    if (i >= 1) {
      const h = candles[i].h,
        l = candles[i].l,
        pc = candles[i - 1].c;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      if (trs.length >= atrPeriod) {
        let s = 0;
        for (let j = trs.length - atrPeriod; j < trs.length; j++) s += trs[j];
        a = s / atrPeriod;
      }
    }
    if (a === null) continue;
    const hl2 = (candles[i].h + candles[i].l) / 2;
    const basicUp = hl2 - mult * a;
    const basicDn = hl2 + mult * a;
    const prevClose = i ? candles[i - 1].c : candles[i].c;
    upBand =
      upBand === null || prevClose <= upBand
        ? basicUp
        : Math.max(basicUp, upBand);
    dnBand =
      dnBand === null || prevClose >= dnBand
        ? basicDn
        : Math.min(basicDn, dnBand);
    const close = candles[i].c;
    if (state <= 0 && close > dnBand) {
      state = 1;
      upBand = basicUp; // re-seed the new support
    } else if (state === 1 && close < upBand) {
      state = -1;
      dnBand = basicDn; // re-seed the new resistance
    } else if (state === 0) {
      state = close > dnBand ? 1 : -1;
    }
    states[i] = state;
  }
  return states;
}

const supertrendEntry: EntryFn = (candles, closes, end, p) => {
  const { atr_period, mult, confirm_bars, regime_period } = p;
  if (end + 1 < Math.max(atr_period + 2, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const states = supertrendStates(candles, end, atr_period, mult);
  if (states[end] !== 1) return false;
  // fresh flip: a non-up state within the last confirm_bars bars before now
  const from = Math.max(0, end - confirm_bars);
  if (from >= end) return false;
  for (let i = from; i < end; i++) if (states[i] !== 1) return true;
  return false;
};

const bbReversionEntry: EntryFn = (candles, closes, end, p) => {
  const { period, k, z_entry, regime_period } = p;
  if (end + 1 < Math.max(period + 1, regime_period + 1)) return false;
  if (!uptrend(closes, end, regime_period)) return false;
  const mid = sma(closes, end, period),
    sd = stdev(closes, end, period);
  const prevMid = sma(closes, end - 1, period),
    prevSd = stdev(closes, end - 1, period);
  if (
    mid === null ||
    sd === null ||
    prevMid === null ||
    prevSd === null ||
    sd <= 0 ||
    prevSd <= 0
  )
    return false;
  const lower = mid - k * sd;
  const prevLower = prevMid - k * prevSd;
  const prevClose = closes[end - 1];
  // prior bar: a >= z_entry-sigma stretch that closed at/below its lower band
  if (!(prevClose <= prevLower && (prevMid - prevClose) / prevSd >= z_entry))
    return false;
  // current bar: snapped back inside the band (don't catch the knife)
  return closes[end] > lower;
};

const squeezeBreakoutEntry: EntryFn = (candles, closes, end, p) => {
  const {
    bb_period,
    k_bb,
    k_kc,
    atr_period,
    lookback,
    squeeze_lookback,
    vol_period,
    vol_mult,
    buffer,
    max_chase,
    min_atr_frac,
    regime_period,
  } = p;
  if (
    end + 1 <
    Math.max(
      lookback + 1,
      bb_period + 1,
      atr_period + 1,
      vol_period + 1,
      regime_period + 1,
    )
  )
    return false;
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
    if (sd !== null && ka !== null && k_bb * sd < k_kc * ka) {
      wasSqueezed = true;
      break;
    }
  }
  if (!wasSqueezed) return false;
  let windowHigh = 0;
  for (let i = end - lookback; i < end; i++)
    windowHigh = Math.max(windowHigh, candles[i].h);
  if (windowHigh <= 0) return false;
  if (price < windowHigh * (1 + buffer)) return false;
  if (price > windowHigh * (1 + max_chase)) return false;
  const av = avgVolume(candles, end - 1, vol_period);
  return av !== null && candles[end].v >= vol_mult * av;
};

// Exported so signal-level parity against bot/strategies/*.py can be scripted.
export const ENTRY: Record<BuiltinTemplate, EntryFn> = {
  tsmom: tsmomEntry,
  supertrend: supertrendEntry,
  ma_crossover: maCrossoverEntry,
  rsi: rsiEntry,
  momentum: momentumEntry,
  vol_expansion: volExpansionEntry,
  fast_rsi: rsiEntry, // same rule as rsi, different stock params
  bb_reversion: bbReversionEntry,
  squeeze_breakout: squeezeBreakoutEntry,
};

// ---------- custom params: merge + validation ----------

/** Stock params merged with a user's overrides (unknown keys ignored). */
export function mergedParams(
  template: SimTemplate,
  overrides?: Record<string, number> | null,
): Record<string, number> {
  const stock = TEMPLATE_CONFIG[template].params;
  if (!overrides) return stock;
  const out = { ...stock };
  for (const spec of TEMPLATE_CONFIG[template].editable) {
    const v = overrides[spec.key];
    if (typeof v === "number" && Number.isFinite(v)) out[spec.key] = v;
  }
  return out;
}

/** Cross-field sanity rules a param set must satisfy (beyond per-field bounds). */
export function paramRuleError(
  template: SimTemplate,
  params: Record<string, number>,
): string | null {
  if (template === "ma_crossover" && params.fast >= params.slow)
    return "Fast SMA period must be below the slow SMA period.";
  if (template === "vol_expansion" && params.short_atr >= params.long_atr)
    return "Short ATR period must be below the long ATR period.";
  return null;
}

/** Server-side gate for user-supplied params: keeps only this template's editable keys,
 *  coerces to finite numbers, clamps to the spec bounds, rounds integer fields, and
 *  enforces cross-field rules. Returns null when the result equals stock (nothing to store).
 *  Throws on cross-field violations so the caller can surface the message. */
export function sanitizeParams(
  template: PickableTemplate,
  input: unknown,
): Record<string, number> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error("params must be an object");
  const raw = input as Record<string, unknown>;
  const cfg = TEMPLATE_CONFIG[template];
  const out: Record<string, number> = {};
  for (const spec of cfg.editable) {
    let v = Number(raw[spec.key]);
    if (!Number.isFinite(v)) continue;
    v = Math.min(spec.max, Math.max(spec.min, v));
    if (spec.int) v = Math.round(v);
    else v = Number(v.toFixed(6)); // strip float noise from step arithmetic
    if (v !== cfg.params[spec.key]) out[spec.key] = v;
  }
  if (Object.keys(out).length === 0) return null;
  const err = paramRuleError(template, { ...cfg.params, ...out });
  if (err) throw new Error(err);
  return out;
}

// ---------- walk-forward simulation ----------

/** Replay the template over the candles: enter on the entry rule when flat, exit via the
 *  engine's protective layer (checked on each bar's close, same as the live poll loop).
 *  `overrides` are custom entry params merged over stock (exits always stay stock -
 *  the worker's config_gen only honors entry-param overrides). */
export function simulate(
  template: BuiltinTemplate,
  candles: Candle[],
  overrides?: Record<string, number> | null,
): SimResult {
  const cfg = TEMPLATE_CONFIG[template];
  const entryFn = ENTRY[template];
  const params = mergedParams(template, overrides);
  return runSim(
    candles,
    (cs, closes, i) => entryFn(cs, closes, i, params),
    cfg.exits,
  );
}

/** Generic engine shared by the builtin templates and user-built (custom) strategies:
 *  long-only, enter at bar close when flat, protective exits checked on every close. */
export function runSim(
  candles: Candle[],
  canEnter: (candles: Candle[], closes: number[], end: number) => boolean,
  exits: ExitConfig,
): SimResult {
  const closes = candles.map((c) => c.c);
  const { stopLossPct, takeProfitPct, chandelierK, atrPeriod, maxHoldBars } =
    exits;

  const trades: SimTrade[] = [];
  let inPos = false;
  let entryIdx = 0,
    entryPrice = 0,
    peak = 0;
  let barsInPos = 0;

  for (let i = 1; i < candles.length; i++) {
    const close = closes[i];
    if (inPos) {
      peak = Math.max(peak, close);
      let reason: SimTrade["reason"] | null = null;
      if (close <= entryPrice * (1 - stopLossPct)) reason = "stop";
      else if (takeProfitPct > 0 && close >= entryPrice * (1 + takeProfitPct))
        reason = "target";
      else if (chandelierK > 0) {
        const a = atr(candles, i, atrPeriod);
        if (a !== null && close <= peak - chandelierK * a) reason = "trail";
      }
      if (!reason && maxHoldBars > 0 && i - entryIdx >= maxHoldBars)
        reason = "time";
      if (reason) {
        const grossPct = ((close - entryPrice) / entryPrice) * 100;
        trades.push({
          entryIdx,
          exitIdx: i,
          entryPrice,
          exitPrice: close,
          grossPct,
          netPct: grossPct - FRICTION_PCT,
          reason,
        });
        inPos = false;
      } else {
        barsInPos++;
      }
    } else if (canEnter(candles, closes, i)) {
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
    trades.push({
      entryIdx,
      exitIdx: null,
      entryPrice,
      exitPrice: last,
      grossPct,
      netPct: grossPct - FRICTION_PCT,
      reason: "open",
    });
  }

  const closedTrades = trades.filter((t) => t.exitIdx !== null);
  const wins = closedTrades.filter((t) => t.netPct > 0).length;
  const totalNetPct =
    (closedTrades.reduce((eq, t) => eq * (1 + t.netPct / 100), 1) - 1) * 100;
  const buyHoldPct =
    closes.length > 1
      ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
      : 0;

  return {
    trades,
    closed: closedTrades.length,
    wins,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : null,
    totalNetPct,
    buyHoldPct,
    exposurePct:
      candles.length > 1 ? (barsInPos / (candles.length - 1)) * 100 : 0,
  };
}

// ---------- walk-forward fold statistics ----------

/** Per-fold out-of-sample stats. Folds partition the candle window into equal
 *  consecutive segments; a trade belongs to the fold its ENTRY falls in. Because
 *  entries only look backward and params are fixed (never re-fit per fold), slicing
 *  one continuous simulation this way is exactly a rolling-origin out-of-sample
 *  evaluation - and unlike per-fold restarts, position state carries across
 *  boundaries the same way the live engine's would. */
export interface FoldStat {
  fold: number; // 1-based
  fromIdx: number; // candle index range [fromIdx, toIdx)
  toIdx: number;
  fromT: number; // timestamps of the range, for axis labels
  toT: number;
  entries: number; // trades entered in this fold (incl. one still open)
  closed: number; // closed trades counted in the stats below
  netPct: number; // compounded net return across this fold's closed trades
  maxDrawdownPct: number; // worst peak-to-trough on the fold's trade-by-trade equity
  profitFactor: number | null; // gross net wins / gross net losses; null = no losers
}

export interface WalkForward {
  folds: FoldStat[];
  positiveFolds: number; // folds with closed trades and netPct > 0
  tradedFolds: number; // folds with at least one closed trade
  medianNetPct: number | null; // median fold net over traded folds
  worstDrawdownPct: number; // max of the per-fold drawdowns
}

/** Partition a simulation into `nFolds` equal windows and score each one. */
export function walkForward(
  sim: SimResult,
  candles: Candle[],
  nFolds = 5,
): WalkForward {
  const n = candles.length;
  const folds: FoldStat[] = [];
  const k = Math.max(1, Math.min(nFolds, Math.floor(n / 2) || 1));
  for (let f = 0; f < k; f++) {
    const fromIdx = Math.floor((f * n) / k);
    const toIdx = f === k - 1 ? n : Math.floor(((f + 1) * n) / k);
    const mine = sim.trades.filter(
      (t) => t.entryIdx >= fromIdx && t.entryIdx < toIdx,
    );
    const closed = mine.filter((t) => t.exitIdx !== null);
    let eq = 1,
      peak = 1,
      dd = 0,
      grossWin = 0,
      grossLoss = 0;
    for (const t of closed) {
      eq *= 1 + t.netPct / 100;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, 1 - eq / peak);
      if (t.netPct >= 0) grossWin += t.netPct;
      else grossLoss -= t.netPct;
    }
    folds.push({
      fold: f + 1,
      fromIdx,
      toIdx,
      fromT: candles[fromIdx]?.t ?? 0,
      toT: candles[Math.max(fromIdx, toIdx - 1)]?.t ?? 0,
      entries: mine.length,
      closed: closed.length,
      netPct: (eq - 1) * 100,
      maxDrawdownPct: dd * 100,
      profitFactor:
        closed.length === 0 ? null : grossLoss > 0 ? grossWin / grossLoss : null,
    });
  }
  const traded = folds.filter((f) => f.closed > 0);
  const nets = traded.map((f) => f.netPct).sort((a, b) => a - b);
  const medianNetPct = nets.length
    ? nets.length % 2
      ? nets[(nets.length - 1) / 2]
      : (nets[nets.length / 2 - 1] + nets[nets.length / 2]) / 2
    : null;
  return {
    folds,
    positiveFolds: traded.filter((f) => f.netPct > 0).length,
    tradedFolds: traded.length,
    medianNetPct,
    worstDrawdownPct: Math.max(0, ...folds.map((f) => f.maxDrawdownPct)),
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

export function smaSeries(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) => sma(closes, i, n));
}

/** Highest of the PREVIOUS `lookback` bars (excl current) - the Donchian entry level. */
export function priorHighSeries(
  values: number[],
  lookback: number,
): (number | null)[] {
  return values.map((_, i) => {
    if (i < lookback) return null;
    let hi = -Infinity;
    for (let j = i - lookback; j < i; j++) hi = Math.max(hi, values[j]);
    return hi;
  });
}

/** The price levels each template actually watches, so the chart explains the entries. */
export function overlays(
  template: BuiltinTemplate,
  candles: Candle[],
  overrides?: Record<string, number> | null,
): OverlaySeries[] {
  const p = mergedParams(template, overrides);
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const regime: OverlaySeries = {
    name: `Regime SMA(${p.regime_period})`,
    points: smaSeries(closes, p.regime_period),
    role: "secondary",
  };
  switch (template) {
    case "tsmom":
      return [
        {
          name: `${p.lookback}-bar high`,
          points: priorHighSeries(highs, p.lookback),
          role: "primary",
        },
        regime,
      ];
    case "supertrend": {
      // The active supertrend band per bar: support while up, resistance while down.
      const n = candles.length;
      const line: (number | null)[] = new Array(n).fill(null);
      const trs: number[] = [];
      let upBand: number | null = null,
        dnBand: number | null = null,
        state = 0;
      for (let i = 0; i < n; i++) {
        let a: number | null = null;
        if (i >= 1) {
          const h = candles[i].h,
            l = candles[i].l,
            pc = candles[i - 1].c;
          trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
          if (trs.length >= p.atr_period) {
            let s = 0;
            for (let j = trs.length - p.atr_period; j < trs.length; j++)
              s += trs[j];
            a = s / p.atr_period;
          }
        }
        if (a === null) continue;
        const hl2 = (candles[i].h + candles[i].l) / 2;
        const basicUp = hl2 - p.mult * a;
        const basicDn = hl2 + p.mult * a;
        const prevClose = i ? candles[i - 1].c : candles[i].c;
        upBand =
          upBand === null || prevClose <= upBand
            ? basicUp
            : Math.max(basicUp, upBand);
        dnBand =
          dnBand === null || prevClose >= dnBand
            ? basicDn
            : Math.min(basicDn, dnBand);
        const close = candles[i].c;
        if (state <= 0 && close > dnBand) {
          state = 1;
          upBand = basicUp;
        } else if (state === 1 && close < upBand) {
          state = -1;
          dnBand = basicDn;
        } else if (state === 0) {
          state = close > dnBand ? 1 : -1;
        }
        line[i] = state === 1 ? upBand : dnBand;
      }
      return [
        { name: `Supertrend (${p.mult}× ATR)`, points: line, role: "primary" },
        regime,
      ];
    }
    case "ma_crossover":
      return [
        {
          name: `SMA(${p.fast})`,
          points: smaSeries(closes, p.fast),
          role: "primary",
        },
        {
          name: `SMA(${p.slow})`,
          points: smaSeries(closes, p.slow),
          role: "secondary",
        },
      ];
    case "momentum":
      return [
        {
          name: `${p.lookback}-bar high`,
          points: priorHighSeries(highs, p.lookback),
          role: "primary",
        },
        regime,
      ];
    case "squeeze_breakout":
      return [
        {
          name: `${p.lookback}-bar high`,
          points: priorHighSeries(highs, p.lookback),
          role: "primary",
        },
        regime,
      ];
    case "vol_expansion":
      return [
        {
          name: `${p.breakout_lookback}-bar close high`,
          points: priorHighSeries(closes, p.breakout_lookback),
          role: "primary",
        },
        regime,
      ];
    case "bb_reversion": {
      const upper = closes.map((_, i) => {
        const m = sma(closes, i, p.period),
          sd = stdev(closes, i, p.period);
        return m !== null && sd !== null ? m + p.k * sd : null;
      });
      const lower = closes.map((_, i) => {
        const m = sma(closes, i, p.period),
          sd = stdev(closes, i, p.period);
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
