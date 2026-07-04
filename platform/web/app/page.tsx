import { HeroCta } from "@/components/HeroCta";
import { STRATEGY_META } from "@/lib/strategies";

// The strategy templates that actually ship - shown as a terminal-style ledger.
const STRATS: [keyof typeof STRATEGY_META, string][] = [
  ["ma_crossover", "BTC/INR"],
  ["momentum", "BTC/INR"],
  ["rsi", "ETH/INR"],
  ["fast_rsi", "BNB/INR"],
  ["vol_expansion", "XRP/INR"],
  ["bb_reversion", "SOL/INR"],
  ["squeeze_breakout", "DOGE/INR"],
];

const STEPS: [string, string][] = [
  ["Link your keys", "Add a CoinDCX API key with trading on and withdrawals off. Stored encrypted."],
  ["Pick strategies", "Preview each template's entries and exits on live market data, then add the ones you like."],
  ["Let it run", "Bots trade on a schedule against your balance. Start in DRY_RUN, go live when ready."],
];

const FEATURES: [string, string][] = [
  ["All 7 strategy templates", "Trend, momentum, mean-reversion, volatility and breakout systems - every template unlocked."],
  ["Entry / exit previews", "Every strategy is simulated on real candles before you add it, with entries and exits marked on the chart."],
  ["Full analytics dashboard", "Equity curve, drawdown, daily P&L, win rate and per-strategy breakdown - plus a pro view with technical metrics."],
  ["Risk-managed executor", "Hard stops, take-profits, ATR trailing stops, daily loss limits and a kill switch on every strategy."],
  ["Non-custodial by design", "Funds never leave your CoinDCX account. Keys are encrypted, withdrawals stay disabled."],
  ["DRY_RUN first", "Paper-trade any setup with realistic fills, fees and TDS before a single rupee goes live."],
];

export default function Home() {
  return (
    <div className="space-y-24">
      {/* Hero - left-aligned, with a strategy ledger as the signature */}
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gain" />
            Non-custodial · CoinDCX · Free during early access
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Algorithmic trading that runs on your <span className="text-accent">own</span> account.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted">
            Pick a strategy, see exactly where it would have entered and exited on real market
            data, and let bots trade for you. Your funds never leave CoinDCX - we hold the keys
            to run the strategies, nothing else.
          </p>
          <HeroCta />
        </div>

        {/* Signature: the strategy ledger - real templates, terminal readout */}
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              strategy_templates
            </span>
            <span className="font-mono text-[11px] text-muted">{STRATS.length} shipped</span>
          </div>
          <ul className="divide-y divide-line/70">
            {STRATS.map(([name, market]) => (
              <li key={name} className="flex items-center gap-3 px-4 py-2.5 font-mono text-[13px]">
                <span className="text-gain">▸</span>
                <span className="text-fg">{name.replace(/_/g, " ")}</span>
                <span className="ml-auto tnum text-muted">{market}</span>
                <span className="w-[88px] text-right text-[10px] uppercase tracking-wider text-faint">
                  {STRATEGY_META[name].kind}
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

      {/* Everything included - pricing is off, the whole platform is free */}
      <section id="features">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Free while we&rsquo;re in early access. Everything included.
            </h2>
            <p className="mt-1 text-sm text-muted">
              No plans, no card, no trading fees from us - your exchange fees apply as usual.
            </p>
          </div>
          <span className="rounded-md border border-gain/40 bg-gain/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-gain">
            ₹0 / mo
          </span>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div key={title} className="bg-panel p-5">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-fg">
                <span className="text-gain">✓</span>
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
