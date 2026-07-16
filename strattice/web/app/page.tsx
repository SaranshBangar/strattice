import type { Metadata } from "next";
import { FaqList } from "@/components/FaqList";
import { HeroCta } from "@/components/HeroCta";
import { JsonLd } from "@/components/JsonLd";
import { LiveChart } from "@/components/LiveChart";
import { Reveal } from "@/components/Reveal";
import { StrategyDemo } from "@/components/StrategyDemo";
import { StrategyQuiz } from "@/components/StrategyQuiz";
import { Term } from "@/components/Term";
import { STRATEGY_META } from "@/lib/strategies";
import { faqPageSchema, softwareApplicationSchema } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Strattice · Algorithmic trading on your own CoinDCX account",
  description:
    "Backtest-proven strategy templates, a visual strategy builder and a paper-trading-first bot that runs on your own CoinDCX account. Non-custodial - your keys, your exchange, your money.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Strattice · Algorithmic trading on your own CoinDCX account",
    description:
      "Backtest-proven strategy templates, a visual strategy builder and a paper-trading-first bot. Non-custodial - your keys, your exchange, your money.",
    url: "/",
  },
};

// The strategy templates that actually ship - shown as a terminal-style ledger.
// The ACTIVE daily lineup (research/FINDINGS.md), each on its venue-robust market.
const STRATS: [keyof typeof STRATEGY_META, string][] = [
  ["tsmom", "ETH/INR"],
  ["momentum", "BTC/INR"],
  ["squeeze_breakout", "DOGE/INR"],
  ["ma_crossover", "XRP/INR"],
  ["vol_expansion", "BNB/INR"],
  ["supertrend", "BTC/INR"],
  ["hf_forecast", "BTC/INR"],
];

const NUMBERS: [string, string][] = [
  ["6", "backtest-proven daily templates, plus an experimental AI forecaster"],
  ["4", "risk checks in front of every single order"],
  ["~1.5%", "real round-trip cost, modeled in every simulation"],
  ["₹0", "per month while we're in early access"],
];

const STEPS: [string, string][] = [
  ["Connect your exchange", "Add a CoinDCX API key with withdrawals off - the bot can trade for you, never take money out."],
  ["Pick a ready-made strategy", "Every entry and exit marked on real market data before you commit to anything."],
  ["Let it practice first", "Paper mode first: real prices, fake money. Flip to live only when the numbers earn it."],
];

// The engine's order path, stage by stage. This mirrors what the code actually
// does - signal, risk gate, executor, exchange - not marketing abstraction.
const PIPELINE: [string, string, string[]][] = [
  [
    "signal",
    "Each enabled strategy evaluates the latest candle and emits BUY, SELL or HOLD. Every decision is logged, including the boring ones.",
    [],
  ],
  [
    "risk gate",
    "A blocked order is a normal outcome, not an error. Any breached limit stops the trade before it exists.",
    ["position size cap", "daily loss limit", "trades-per-day cap", "capital-at-risk ceiling"],
  ],
  [
    "executor",
    "One order path for everything. Idempotent order ids survive restarts; protective exits override the strategy's own signal.",
    ["hard stop-loss", "take-profit / ATR trail", "DRY_RUN honored"],
  ],
  ["your exchange", "The order lands on your own CoinDCX account, placed with your key. Fills, P&L and TDS are persisted per trade.", []],
];

// One ₹10,000 round trip on an INR pair. These are the numbers most bots
// quietly leave out - GST on fees and TDS on the sell leg.
const COST_ROWS: [string, string, string][] = [
  ["buy", "exchange fee · 0.2%", "20.00"],
  ["buy", "GST on fee · 18%", "3.60"],
  ["sell", "exchange fee · 0.2%", "20.00"],
  ["sell", "GST on fee · 18%", "3.60"],
  ["sell", "TDS · 1%", "100.00"],
];

const FEATURES: [string, string][] = [
  ["Every strategy template", "Trend, momentum, breakout and volatility systems that survived a real-data cost study."],
  ["Entry / exit previews", "Simulated on real candles, entries and exits on the chart, before you add it."],
  ["Build your own", "Compose entry rules from indicator blocks and backtest while you design."],
  ["Full analytics dashboard", "Equity curve, drawdown, daily P&L, win rate, per-strategy breakdown."],
  ["Risk-managed executor", "Hard stops, trailing stops, daily loss limits and a kill switch."],
  ["DRY_RUN first", "Realistic paper fills with fees and TDS before a single rupee goes live."],
];

const FAQ: [string, string][] = [
  [
    "Do I need to know anything about trading?",
    "No. The strategies are pre-built and previewed on real data before you add them, every piece of jargon on the site has a plain-English explanation a hover away, and everything starts in paper mode. You can learn by watching the bot work without risking anything.",
  ],
  [
    "How much money do I need to start?",
    "None. Paper mode trades fake money on real live prices - fees, taxes and all - so the results are honest without a rupee at risk. Going live later is a separate, explicit choice, and even then you set the position size caps.",
  ],
  [
    "Where does my money actually sit?",
    "In your own CoinDCX account, the whole time. Strattice holds an API key you create, with withdrawals disabled, and uses it only to read balances and place orders. We cannot move funds out, and we never touch custody.",
  ],
  [
    "Can a strategy lose money?",
    "Yes. Every strategy here can and sometimes will lose. That's what the hard stops, daily loss limit and kill switch are for. Nothing on this site is a guarantee of profit, and simulated results never promise live ones.",
  ],
  [
    "Can I try it without risking anything?",
    "That's the default. New bots run in DRY_RUN: the engine simulates fills at real prices, including fees, GST and TDS, so the dashboard numbers are honest. You flip to live explicitly, and only when you choose to.",
  ],
  [
    "Can I stop instantly?",
    "Turn the bot off from your account page and no new entries are placed from the next poll. One honest detail: a strategy disabled while holding a position keeps managing that position's exit until it's flat. Abandoning an open trade would be worse.",
  ],
  [
    "Why is it free?",
    "Early access. We want real usage and blunt feedback more than early revenue. If paid plans ever arrive you'll be told well in advance, and nothing will ever be charged without your explicit consent.",
  ],
];

export default function Home() {
  return (
    <div className="space-y-24 -mt-24">
      {/* Rich-result structured data. FAQPage is built from the same FAQ array
          rendered below, so the schema always matches the visible content. */}
      <JsonLd schema={softwareApplicationSchema()} />
      <JsonLd schema={faqPageSchema(FAQ)} />

      {/* Hero - left-aligned, with a strategy ledger as the signature */}
      <section className="rise grid items-center gap-10 pt-12 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pt-6">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-[1px] bg-gain" />
            Non-custodial · CoinDCX · Free during early access
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Algorithmic trading that runs on your <span className="text-accent">own</span> account.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted">
            Pick a rulebook. Watch it practice with{" "}
            <span className="font-medium text-fg">fake money on real prices</span>
            . Go live only once it has{" "}
            <span className="font-medium text-fg">earned your trust</span>.
          </p>
          <HeroCta />
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-faint">no card · withdrawals stay disabled · DRY_RUN by default</p>
          <a
            href="#learn"
            className="mt-3 inline-block text-sm text-dim underline decoration-line underline-offset-4 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New to trading? Start here ↓
          </a>
        </div>

        {/* Signature: the strategy ledger boots one row at a time, like a terminal */}
        <div id="templates" className="card scroll-mt-20 overflow-hidden">
          <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">strategy_templates</span>
            <span className="font-mono text-[11px] text-muted">{STRATS.length} shipped</span>
          </div>
          <ul className="boot">
            {STRATS.map(([name, market]) => (
              <li key={name} className="flex items-center gap-3 px-4 py-2.5 font-mono text-[13px] transition-colors hover:bg-white/[0.03]">
                <span className="text-gain">▸</span>
                <span className="text-fg">{name.replace(/_/g, " ")}</span>
                <span className="ml-auto tnum text-muted">{market}</span>
                <span className="w-[88px] text-right text-[10px] uppercase tracking-wider text-faint">{STRATEGY_META[name].kind}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2.5 font-mono text-[11px] text-faint">
            <span className="caret">exits: shared stop-loss / take-profit / ATR trail</span>
            <span className="text-accent">+ build your own</span>
          </div>
        </div>
      </section>

      {/* Live tape - real trades streaming in, proof the market data is real */}
      <Reveal>
        <LiveChart />
      </Reveal>

      {/* Newcomer on-ramp: what algorithmic trading actually is, in plain
          English, then an animated demo of one strategy doing its job. */}
      <section id="learn" className="scroll-mt-20">
        <Reveal>
          <h2 className="eyebrow">New to trading?</h2>
          <p className="mt-2 max-w-2xl font-display text-2xl font-semibold tracking-tight">What is algorithmic trading?</p>
        </Reveal>
        <Reveal stagger>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold tracking-tight text-fg">A strategy is a rulebook</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                A <Term k="strategy">strategy</Term> is written-down rules: if the price does X, buy; if Y, sell. Exact rules can be tested on years
                of history (a <Term k="backtest">backtest</Term>) first.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold tracking-tight text-fg">The bot never sleeps or panics</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                It applies the same rules every time - no revenge trades, no 3am chases. It waits for a <Term k="signal">signal</Term> and follows the
                plan.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold tracking-tight text-fg">You keep the controls</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Everything starts in <Term k="paper trading">paper trading</Term>. Every trade carries a <Term k="stop-loss">stop-loss</Term>, and
                your funds never leave your own exchange account.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal>
          <div className="mt-6">
            <StrategyDemo />
          </div>
        </Reveal>
      </section>

      {/* Numbers strip - four facts, no adjectives */}
      <Reveal stagger>
        <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map(([n, body]) => (
            <div key={body} className="card px-5 py-4">
              <div className="font-mono text-2xl font-semibold tnum tracking-tight text-fg">{n}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>
      </Reveal>

      {/* How it works - a real three-step sequence, so the numbering earns its place */}
      <section>
        <Reveal>
          <h2 className="eyebrow">How it works</h2>
        </Reveal>
        <Reveal stagger>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="card p-5">
                <span className="font-mono text-sm text-accent">0{i + 1}</span>
                <h3 className="mt-3 font-display text-base font-semibold tracking-tight text-fg">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* The execution path - what actually happens between a signal and a fill */}
      <section>
        <Reveal>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="eyebrow">The execution path</h2>
              <p className="mt-2 max-w-2xl font-display text-2xl font-semibold tracking-tight">
                Four stages between a signal and your exchange. Risk sits in the middle, always.
              </p>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-faint">signal → risk → execute → fill</span>
          </div>
        </Reveal>
        <Reveal stagger>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(([title, body, checks], i) => (
              <li key={title} className="card relative p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{title}</span>
                  {i < PIPELINE.length - 1 && (
                    <span aria-hidden="true" className="font-mono text-sm text-faint">
                      →
                    </span>
                  )}
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{body}</p>
                {checks.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-lg bg-inset/70 p-3">
                    {checks.map((c) => (
                      <li key={c} className="flex items-center gap-2 font-mono text-[11px] text-dim">
                        <span className="h-1 w-1 shrink-0 bg-faint" />
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* Costs - the honest section. Most bots pretend friction doesn't exist. */}
      <section id="costs" className="scroll-mt-20 grid items-start gap-10 lg:grid-cols-[1fr_0.9fr]">
        <Reveal>
          <h2 className="eyebrow">Costs, modeled honestly</h2>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Every round trip on an Indian exchange costs about 1.5% before you earn a rupee.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            Fees on both legs, GST on those fees, 1% TDS on every sell - every number on Strattice is{" "}
            <span className="text-fg">net of the full friction stack</span>, which is why the engine trades slow{" "}
            <span className="text-fg">daily bars</span>.
          </p>
        </Reveal>
        <Reveal>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">round_trip · ₹10,000</span>
              <span className="font-mono text-[11px] text-muted">INR pair</span>
            </div>
            <table className="w-full font-mono text-[13px]">
              <tbody>
                {COST_ROWS.map(([leg, what, amt], i) => (
                  <tr key={i} className="odd:bg-white/[0.015]">
                    <td className="w-14 px-4 py-2.5 text-[10px] uppercase tracking-wider text-faint">{leg}</td>
                    <td className="py-2.5 pr-4 text-muted">{what}</td>
                    <td className="tnum py-2.5 pr-4 text-right text-dim">₹{amt}</td>
                  </tr>
                ))}
                <tr className="bg-loss/[0.06]">
                  <td className="px-4 py-3 text-[10px] uppercase tracking-wider text-faint">total</td>
                  <td className="py-3 pr-4 font-medium text-fg">friction paid</td>
                  <td className="tnum py-3 pr-4 text-right font-semibold text-loss">₹147.20</td>
                </tr>
              </tbody>
            </table>
            {/* Where the ₹147.20 goes - TDS dominates. Labels carry identity;
                red carries the story. */}
            <div className="px-4 pb-4 pt-1">
              <div
                className="flex h-2.5 gap-[2px] overflow-hidden rounded-[2px]"
                role="img"
                aria-label="Friction split of ₹147.20: exchange fees ₹40, GST ₹7.20, TDS ₹100"
              >
                <div className="bg-muted" style={{ width: "27.2%" }} />
                <div className="bg-faint" style={{ width: "4.9%" }} />
                <div className="bg-loss" style={{ width: "67.9%" }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 bg-muted" />
                  fees ₹40.00
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 bg-faint" />
                  gst ₹7.20
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-1.5 bg-loss" />
                  tds ₹100.00
                </span>
              </div>
            </div>
            <div className="bg-white/[0.03] px-4 py-2.5 font-mono text-[11px] text-faint">
              ≈ 1.47% of notional. simulations here start from this number, not from zero.
            </div>
          </div>
        </Reveal>
      </section>

      {/* Everything included - pricing is off, the whole platform is free */}
      <section id="features" className="scroll-mt-20">
        <Reveal>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">Free while we&rsquo;re in early access. Everything included.</h2>
              <p className="mt-1 text-sm text-muted">No plans, no card, no trading fees from us. Your exchange fees apply as usual.</p>
            </div>
            <span className="rounded-sm bg-gain/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-gain">₹0 / mo</span>
          </div>
        </Reveal>
        <Reveal stagger>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, body]) => (
              <div key={title} className="card p-5">
                <h3 className="flex items-center gap-2.5 font-display text-base font-semibold tracking-tight text-fg">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 bg-accent" />
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Which strategy fits you? Five questions, one honest starting point. */}
      <section id="quiz" className="scroll-mt-20">
        <Reveal>
          <div className="mb-5">
            <h2 className="eyebrow">Not sure where to start?</h2>
            <p className="mt-2 max-w-2xl font-display text-2xl font-semibold tracking-tight">Five questions, one honest starting point.</p>
          </div>
        </Reveal>
        <Reveal>
          <StrategyQuiz />
        </Reveal>
      </section>

      {/* FAQ - the questions a skeptical trader actually asks */}
      <section id="faq" className="scroll-mt-20 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <h2 className="eyebrow">Straight answers</h2>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">The questions a skeptical trader should ask.</p>
        </Reveal>
        <Reveal>
          <FaqList items={FAQ} />
        </Reveal>
      </section>

      {/* Final CTA - one quiet band */}
      <Reveal className="!mt-12">
        <section className="card relative overflow-hidden px-6 py-12 text-center sm:px-10">
          <div className="relative">
            <p className="eyebrow">Start in DRY_RUN</p>
            <h2 className="mx-auto mt-3 max-w-xl font-display text-3xl font-bold leading-tight tracking-tight">
              Watch a strategy trade your account without spending a rupee.
            </h2>
            <div className="flex justify-center">
              <HeroCta />
            </div>
          </div>
        </section>
      </Reveal>
    </div>
  );
}
