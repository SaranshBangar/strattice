import { TIERS } from "@/lib/entitlements";
import { PricingGrid } from "@/components/PricingGrid";
import { HeroCta } from "@/components/HeroCta";

const ORDER = ["free", "starter", "plus", "pro", "max"] as const;
const PERKS: Record<string, string> = {
  free: "1 default strategy",
  starter: "1 default strategy",
  plus: "Any 3 strategies + dashboard",
  pro: "All strategies + dashboard",
  max: "All + custom strategies + dashboard",
};

// The strategy templates that actually ship - shown as a terminal-style ledger.
const STRATS: [string, string, string][] = [
  ["ma_crossover", "BTC/INR", "TREND"],
  ["momentum", "BTC/INR", "MOMENTUM"],
  ["rsi", "ETH/INR", "MEAN-REV"],
  ["fast_rsi", "BNB/INR", "MEAN-REV"],
  ["vol_expansion", "XRP/INR", "VOLATILITY"],
  ["squeeze_breakout", "DOGE/INR", "BREAKOUT"],
];

const STEPS: [string, string][] = [
  ["Link your keys", "Add a CoinDCX API key with trading on and withdrawals off. Stored encrypted."],
  ["Pick strategies", "Choose from the templates your plan unlocks, and set the markets they trade."],
  ["Let it run", "Bots trade on a schedule against your balance. Start in DRY_RUN, go live when ready."],
];

export default function Home() {
  const tiers = ORDER.map((k) => ({
    name: TIERS[k].name,
    priceInr: TIERS[k].priceInr,
    tradesPerDay: TIERS[k].tradesPerDay,
    perk: PERKS[k],
  }));

  return (
    <div className="space-y-24">
      {/* Hero - left-aligned, with a strategy ledger as the signature */}
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gain" />
            Non-custodial · CoinDCX
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Algorithmic trading that runs on your <span className="text-accent">own</span> account.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted">
            Subscribe to a strategy and let bots trade for you. Your funds never leave CoinDCX -
            we hold the keys to run the strategies, nothing else.
          </p>
          <HeroCta />
        </div>

        {/* Signature: the strategy ledger - real templates, terminal readout */}
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              strategy_templates
            </span>
            <span className="font-mono text-[11px] text-muted">{STRATS.length} active</span>
          </div>
          <ul className="divide-y divide-line/70">
            {STRATS.map(([name, market, tag]) => (
              <li key={name} className="flex items-center gap-3 px-4 py-2.5 font-mono text-[13px]">
                <span className="text-gain">▸</span>
                <span className="text-fg">{name.replace(/_/g, " ")}</span>
                <span className="ml-auto tnum text-muted">{market}</span>
                <span className="w-[88px] text-right text-[10px] uppercase tracking-wider text-faint">
                  {tag}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
            exits handled by shared stop-loss / take-profit / trail
          </div>
        </div>
      </section>

      {/* How it works - a real three-step sequence, so the numbering earns its place */}
      <section>
        <h2 className="eyebrow">How it works</h2>
        <ol className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="bg-panel p-5">
              <span className="font-mono text-sm text-accent">0{i + 1}</span>
              <h3 className="mt-3 font-display text-base font-semibold tracking-tight text-fg">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing">
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Simple monthly plans</h2>
          <p className="mt-1 text-sm text-muted">
            No trading fees from us - your exchange fees apply as usual.
          </p>
        </div>
        <PricingGrid tiers={tiers} ctaHref="/sign-up" />
        <p className="mt-4 text-xs text-faint">
          Recurring billing via Cashfree (UPI Autopay / eMandate).
        </p>
      </section>
    </div>
  );
}
