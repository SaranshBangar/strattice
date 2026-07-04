// Human-facing metadata for strategy templates. The engine keys off the template
// id; this is purely for the UI so users aren't picking from raw snake_case ids.
// Entry/exit text mirrors bot/strategies/*.py + worker/config_gen.py stock params.
import type { Template } from "./entitlements";

export interface StrategyMeta {
  label: string;
  kind: string; // short tag: TREND / MOMENTUM / MEAN-REV / ...
  blurb: string; // one line, what it does
  entry: string; // when the strategy buys (stock params)
  exit: string; // how the engine's protective layer gets it out
  style: string; // holding style, one line
}

export const STRATEGY_META: Record<Template, StrategyMeta> = {
  ma_crossover: {
    label: "MA Crossover",
    kind: "TREND",
    blurb: "Buys when a fast moving average crosses above a slow one; the trail takes care of the exit.",
    entry: "Fast SMA(32) crosses above slow SMA(96) with the gap ≥ 0.5×ATR, the slow MA rising, and price above its 192-bar regime SMA.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit - winners are left to run.",
    style: "Patient trend-follower. Few entries; holds winners for days to weeks.",
  },
  rsi: {
    label: "RSI Reversion",
    kind: "MEAN-REV",
    blurb: "Buys deeply oversold dips in an uptrend and sells the bounce.",
    entry: "RSI(14) drops below 22 while price is above its 192-bar regime SMA, then a candle closes back above the prior bar's high (confirmation).",
    exit: "3% take-profit, 3% hard stop, or a 64-bar time-stop - whichever comes first.",
    style: "Conservative dip-buyer. Small, frequent-ish mean-reversion trades.",
  },
  momentum: {
    label: "Momentum Breakout",
    kind: "MOMENTUM",
    blurb: "Buys fresh breakouts of the recent high on real volume.",
    entry: "Close breaks the prior 32-bar high by ≥ 0.2% (but < 2% - no chasing) on ≥ 1.2× average volume, with ATR above its volatility floor.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit.",
    style: "Breakout rider. Waits for participation, then follows the move.",
  },
  vol_expansion: {
    label: "Volatility Expansion",
    kind: "VOLATILITY",
    blurb: "Enters when volatility pops out of a quiet range at a new local high.",
    entry: "8-bar ATR expands to ≥ 1.6× the 32-bar ATR and price prints a new 24-bar closing high, in an uptrend.",
    exit: "ATR chandelier trail (2.5×ATR off the peak) plus a 2.5% hard stop.",
    style: "Aggressive expansion trader. Fires on regime shifts from quiet to loud.",
  },
  fast_rsi: {
    label: "Fast RSI",
    kind: "MEAN-REV",
    blurb: "A quicker RSI dip-buyer for shorter, sharper reversion trades.",
    entry: "RSI(7) drops below 25 in an uptrend, then a candle closes back above the prior bar's high (confirmation).",
    exit: "2.5% take-profit, 2% hard stop, or a 12-bar time-stop - whichever comes first.",
    style: "Fast in, fast out. More entries, tighter exits than RSI Reversion.",
  },
  bb_reversion: {
    label: "Bollinger Reversion",
    kind: "MEAN-REV",
    blurb: "Fades ≥2σ stretches below the Bollinger band once price snaps back inside.",
    entry: "Prior bar closes ≥ 2σ below the 20-bar Bollinger mid; the current bar closes back inside the band (buy the reversion, not the knife).",
    exit: "4% take-profit, 3% hard stop, or a 32-bar time-stop - whichever comes first.",
    style: "Dislocation fader. Rare, high-conviction snap-back entries.",
  },
  squeeze_breakout: {
    label: "Squeeze Breakout",
    kind: "BREAKOUT",
    blurb: "Waits for a volatility squeeze, then trades the breakout with volume.",
    entry: "Bollinger bands compress inside the Keltner channel (squeeze), then price breaks the prior 20-bar high by ≥ 0.2% on ≥ 1.2× average volume.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit.",
    style: "Coil-and-release. Low-volatility compression before the expansion move.",
  },
};

export function strategyLabel(template: string): string {
  return STRATEGY_META[template as Template]?.label ?? template;
}
