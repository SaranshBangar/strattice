// Tier -> entitlements. MUST stay in sync with worker/entitlements.py (the supervisor is the
// last line of defense, but the UI gates from here). See platform/RESEARCH.md §3.
//
// PRICING IS DISABLED FOR NOW: the platform is fully free. The free tier unlocks
// everything, and the paid tiers are kept only so legacy subscription rows still
// resolve. Checkout is not offered anywhere in the UI.

/** The stock strategy templates that ship with the bot. */
export const BUILTIN_TEMPLATES = [
  "ma_crossover",
  "rsi",
  "momentum",
  "vol_expansion",
  "fast_rsi",
  "bb_reversion",
  "squeeze_breakout",
] as const;
/** Experimental templates: run in the bot's Python engine only (ML model
 *  inference is server-side), so the browser cannot simulate/backtest them.
 *  Kept out of BUILTIN_TEMPLATES so the TS sim never tries. */
export const EXPERIMENTAL_TEMPLATES = ["hf_forecast"] as const;
/** Everything a user may run: builtins + experimental + "custom" (user-built rule
 *  strategies, interpreted by bot/strategies/custom.py; the rule JSON lives in
 *  user_strategies.params). */
export const ALL_TEMPLATES = [
  ...BUILTIN_TEMPLATES,
  ...EXPERIMENTAL_TEMPLATES,
  "custom",
] as const;
export type Template = (typeof ALL_TEMPLATES)[number];
export type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number];
export type ExperimentalTemplate = (typeof EXPERIMENTAL_TEMPLATES)[number];
/** Templates pickable from the template cards (everything except "custom"). */
export type PickableTemplate = BuiltinTemplate | ExperimentalTemplate;
export const DEFAULT_TEMPLATE: Template = "ma_crossover";

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
