// Tier -> entitlements. MUST stay in sync with worker/entitlements.py (the supervisor is the
// last line of defense, but the UI gates from here). See platform/RESEARCH.md §3.

export const ALL_TEMPLATES = [
  "ma_crossover", "rsi", "momentum", "vol_expansion",
  "fast_rsi", "bb_reversion", "squeeze_breakout",
] as const;
export type Template = (typeof ALL_TEMPLATES)[number];
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

const DEFAULT_ONLY = [DEFAULT_TEMPLATE] as const;

export const TIERS: Record<TierName, Tier> = {
  free:    { name: "free",    priceInr: 0,   tradesPerDay: 5,   maxActive: 1,    allowed: DEFAULT_ONLY, custom: false, dashboard: "basic" },
  starter: { name: "starter", priceInr: 299, tradesPerDay: 50,  maxActive: 1,    allowed: DEFAULT_ONLY, custom: false, dashboard: "basic" },
  plus:    { name: "plus",    priceInr: 499, tradesPerDay: 50,  maxActive: 3,    allowed: ALL_TEMPLATES, custom: false, dashboard: "full" },
  pro:     { name: "pro",     priceInr: 749, tradesPerDay: 75,  maxActive: null, allowed: ALL_TEMPLATES, custom: false, dashboard: "full" },
  max:     { name: "max",     priceInr: 999, tradesPerDay: 100, maxActive: null, allowed: ALL_TEMPLATES, custom: true,  dashboard: "full" },
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
