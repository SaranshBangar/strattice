// Human-facing metadata for strategy templates. The engine keys off the template
// id; this is purely for the UI so users aren't picking from raw snake_case ids.
import type { Template } from "./entitlements";

export interface StrategyMeta {
  label: string;
  kind: string; // short tag: TREND / MOMENTUM / MEAN-REV / ...
  blurb: string; // one line, what it does
}

export const STRATEGY_META: Record<Template, StrategyMeta> = {
  ma_crossover: { label: "MA Crossover", kind: "TREND", blurb: "Buys when a fast moving average crosses above a slow one; exits on the reverse." },
  rsi: { label: "RSI Reversion", kind: "MEAN-REV", blurb: "Buys oversold dips and sells into overbought strength using RSI bands." },
  momentum: { label: "Momentum", kind: "MOMENTUM", blurb: "Rides sustained directional moves while momentum stays positive." },
  vol_expansion: { label: "Volatility Expansion", kind: "VOLATILITY", blurb: "Enters when volatility breaks out of a quiet range." },
  fast_rsi: { label: "Fast RSI", kind: "MEAN-REV", blurb: "A shorter-period RSI for quicker mean-reversion entries and exits." },
  bb_reversion: { label: "Bollinger Reversion", kind: "MEAN-REV", blurb: "Fades moves that stretch past the Bollinger bands back toward the mean." },
  squeeze_breakout: { label: "Squeeze Breakout", kind: "BREAKOUT", blurb: "Waits for a volatility squeeze, then trades the breakout direction." },
};

export function strategyLabel(template: string): string {
  return STRATEGY_META[template as Template]?.label ?? template;
}
