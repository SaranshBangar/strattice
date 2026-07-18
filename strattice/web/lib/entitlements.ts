// Tier -> entitlements. MUST stay in sync with worker/entitlements.py (the supervisor is the
// last line of defense, but the UI gates from here). See strattice/RESEARCH.md §3.
//
// PRICING IS DISABLED FOR NOW: the platform is fully free. The free tier unlocks
// everything, and the paid tiers are kept only so legacy subscription rows still
// resolve. Checkout is not offered anywhere in the UI.

/** The ACTIVE stock templates: the daily trend engines that survived the real-data
 *  backtest study (research/FINDINGS.md). Order = picker order, strongest first. */
export const ACTIVE_TEMPLATES = [
  "sharpe_mom",
  "macd_trend",
  "trend_regime",
  "tsmom",
  "ma_crossover",
  "vol_expansion",
  "squeeze_breakout",
  "momentum",
  "supertrend",
  "ichimoku",
] as const;
/** RETIRED templates: mean reversion loses net of India friction at EVERY tested
 *  altitude (research/FINDINGS.md). Not offered for new adds; kept so legacy rows
 *  still resolve, render, and keep their exits managed until removed by the user. */
export const RETIRED_TEMPLATES = ["rsi", "fast_rsi", "bb_reversion"] as const;
/** Everything the TS sim can simulate (active + retired). */
export const BUILTIN_TEMPLATES = [
  ...ACTIVE_TEMPLATES,
  ...RETIRED_TEMPLATES,
] as const;
/** SHORT-CAPABLE templates (the v8 research modules): symmetric long/short trend
 *  engines whose SHORT side is inert on the live spot engine (it acts on exact
 *  BUY/SELL only) - the long side trades, the short side is paper/research. Gated
 *  behind the per-user allow_shorting permission (Settings) and a MANDATORY
 *  stop-loss + take-profit on every add (server-enforced in actions.ts). The v8
 *  study found the short side SUBTRACTS on this venue's history - the risk warning
 *  on each template says so. */
export const SHORT_CAPABLE_TEMPLATES = ["donchian_ls", "ensemble_ls"] as const;
/** Experimental templates: run in the bot's Python engine only (ML inference or
 *  long/short behavior the long-only browser sim cannot express), so there is no
 *  browser preview. Kept out of BUILTIN_TEMPLATES so the TS sim never tries. */
export const EXPERIMENTAL_TEMPLATES = [
  "hf_forecast",
  ...SHORT_CAPABLE_TEMPLATES,
] as const;
/** Everything a user may run: builtins + experimental + "custom" (user-built rule
 *  strategies, interpreted by bot/strategies/custom.py; the rule JSON lives in
 *  user_strategies.params). */
export const ALL_TEMPLATES = [
  ...BUILTIN_TEMPLATES,
  ...EXPERIMENTAL_TEMPLATES,
  "custom",
] as const;
export type Template = (typeof ALL_TEMPLATES)[number];
export type ActiveTemplate = (typeof ACTIVE_TEMPLATES)[number];
export type RetiredTemplate = (typeof RETIRED_TEMPLATES)[number];
export type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number];
export type ExperimentalTemplate = (typeof EXPERIMENTAL_TEMPLATES)[number];
export type ShortCapableTemplate = (typeof SHORT_CAPABLE_TEMPLATES)[number];
export const isShortCapable = (t: string): t is ShortCapableTemplate =>
  (SHORT_CAPABLE_TEMPLATES as readonly string[]).includes(t);
/** Templates pickable from the template cards (active + experimental; retired and
 *  "custom" are excluded — custom has its own builder). */
export type PickableTemplate = ActiveTemplate | ExperimentalTemplate;
export const DEFAULT_TEMPLATE: Template = "tsmom";

export type TierName = "free" | "starter" | "plus" | "pro" | "max";

export interface Tier {
  name: TierName;
  priceInr: number;
  tradesPerDay: number;
  maxActive: number | null; // null = unlimited
  allowed: readonly Template[]; // empty-set meaning handled via includes()
  custom: boolean;
  dashboard: "basic" | "full";
}

export const TIERS: Record<TierName, Tier> = {
  // Everything free while pricing is off: all templates, no active cap, full dashboard.
  free: {
    name: "free",
    priceInr: 0,
    tradesPerDay: 100,
    maxActive: null,
    allowed: ALL_TEMPLATES,
    custom: true,
    dashboard: "full",
  },
  starter: {
    name: "starter",
    priceInr: 0,
    tradesPerDay: 100,
    maxActive: null,
    allowed: ALL_TEMPLATES,
    custom: true,
    dashboard: "full",
  },
  plus: {
    name: "plus",
    priceInr: 0,
    tradesPerDay: 100,
    maxActive: null,
    allowed: ALL_TEMPLATES,
    custom: true,
    dashboard: "full",
  },
  pro: {
    name: "pro",
    priceInr: 0,
    tradesPerDay: 100,
    maxActive: null,
    allowed: ALL_TEMPLATES,
    custom: true,
    dashboard: "full",
  },
  max: {
    name: "max",
    priceInr: 0,
    tradesPerDay: 100,
    maxActive: null,
    allowed: ALL_TEMPLATES,
    custom: true,
    dashboard: "full",
  },
};

export function resolveTier(name?: string | null): Tier {
  return TIERS[(name ?? "").toLowerCase() as TierName] ?? TIERS.free;
}

export function isAllowed(tier: Tier, template: string): boolean {
  return (tier.allowed as readonly string[]).includes(template);
}

/** Active-strategy count a user may still enable given their tier and current enabled count. */
export function canEnableMore(tier: Tier, currentlyEnabled: number): boolean {
  return tier.maxActive === null || currentlyEnabled < tier.maxActive;
}

export const PAID_TIERS: TierName[] = ["starter", "plus", "pro", "max"];
