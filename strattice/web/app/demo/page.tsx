// Public demo dashboard: the real dashboard components fed with deterministic
// sample data (lib/demo-data.ts), so a visitor can see exactly what running
// the bot looks like before creating an account. No auth, no DB - only the
// PriceChart streams real live market data. This page doubles as a teaching
// surface: every metric carries a plain-English hint.
import Link from "next/link";
import { StatCard } from "@/components/StatCard";
import { Metric } from "@/components/Metric";
import { InfoHint } from "@/components/InfoHint";
import { DataTable, type Cell } from "@/components/DataTable";
import { TradesTable } from "@/components/TradesTable";
import { PriceChart } from "@/components/PriceChart";
import {
  EquityCurve,
  PnlBars,
  Sparkline,
  WinRateDonut,
} from "@/components/charts";
import { strategyLabel } from "@/lib/strategies";
import { demoData } from "@/lib/demo-data";

// The sample data is deterministic - only the date labels move with the clock
// (they roll at UTC midnight). Hourly ISR lets the CDN serve cached HTML
// instead of re-rendering per request; the PriceChart still streams live
// prices client-side.
export const revalidate = 3600;

export const metadata = {
  title: "Demo dashboard",
  description:
    "A sample of the Strattice dashboard - what your bot's paper-trading history looks like once it's running. Deterministic sample data, no account needed.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Demo dashboard · Strattice",
    description:
      "What your bot's paper-trading history looks like once it's running - explore the full dashboard with sample data, no account needed.",
    url: "/demo",
  },
};

function fmt(n: number) {
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
function inr(n: number) {
  return `₹${fmt(n)}`;
}
function num(n: number): Cell {
  return { v: fmt(n), align: "right" };
}
function shortDay(d: string) {
  return d?.slice(5) ?? d;
}
function shortTs(ts: string) {
  return ts?.slice(0, 16).replace("T", " ") ?? "";
}
function sample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr;
  return Array.from(
    { length: k },
    (_, j) => arr[Math.round((j * (arr.length - 1)) / (k - 1))],
  );
}

export default function DemoPage() {
  const d = demoData();
  const decided = d.stats.wins + d.stats.losses;
  const winRate = decided ? (d.stats.wins / decided) * 100 : 0;
  const equityXTicks = sample(
    d.equitySeries.map((s) => shortTs(s.ts)),
    5,
  );
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of d.equityVals) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - v) / peak) * 100);
  }
  const dv = d.dailyPnl.map((x) => x.pnl);
  const grossWin = dv.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(dv.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : 0;
  const bestDay = dv.length ? Math.max(...dv) : 0;
  const worstDay = dv.length ? Math.min(...dv) : 0;

  return (
    <div className="space-y-6">
      {/* Demo banner - always visible, so nobody mistakes this for real data */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <span className="mr-3 rounded-sm bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
            demo · sample data
          </span>
          <span className="text-sm text-muted">
            This is what your dashboard looks like once the bot is running —
            90 days of practice trading on a ₹1,000 paper base.
          </span>
        </div>
        <Link
          href="/sign-up"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Get yours free
        </Link>
      </div>

      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-0.5 font-mono text-[11px] text-faint">
          sample engine · every trade below is simulated
        </p>
        <span className="mt-1.5 inline-block rounded-sm bg-gain/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gain">
          practice mode — no real money at risk
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bot"
          value="Running"
          sub="DRY_RUN"
          tone="good"
          hint="Whether the trading engine is switched on. DRY_RUN means it trades practice money; LIVE means real orders."
        />
        <StatCard
          label="Book equity"
          value={inr(d.latestEquity.equity)}
          sub="₹1,000 paper base + realized P&L"
          hint="The bot's own ledger: ₹1,000 of practice money plus everything it has won or lost — not an exchange wallet balance."
          chart={
            d.equityVals.length > 1 ? (
              <Sparkline data={d.equityVals} area />
            ) : undefined
          }
        />
        <StatCard
          label="Realized today"
          value={inr(d.latestEquity.realized_today)}
          sub={`${d.latestEquity.trades_today} trades today`}
          hint="Profit or loss locked in by trades that closed today, after all fees."
          tone={
            d.latestEquity.realized_today < 0
              ? "bad"
              : d.latestEquity.realized_today > 0
                ? "good"
                : "default"
          }
        />
        <StatCard
          label="Paper P&L (all-time)"
          value={inr(d.stats.paperPnl)}
          sub={`${d.stats.paperTrades} DRY_RUN fills`}
          hint="Profit or loss from practice trades — real prices, fake money. A safe preview of how the strategies behave."
          tone={
            d.stats.paperPnl < 0
              ? "bad"
              : d.stats.paperPnl > 0
                ? "good"
                : "default"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric
          label="Win rate"
          value={`${winRate.toFixed(0)}%`}
          hint="Of every trade the bot closed, how many made money."
        />
        <Metric
          label="Max drawdown"
          value={`-${maxDD.toFixed(1)}%`}
          tone="bad"
          hint="The deepest dip below the account's best-ever level. Smaller is calmer."
        />
        <Metric
          label="Profit factor"
          value={profitFactor.toFixed(2)}
          tone={profitFactor >= 1 ? "good" : "bad"}
          hint="Total gains divided by total losses. Above 1 means the wins outweigh the losses."
        />
        <Metric
          label="Best day"
          value={inr(bestDay)}
          tone="good"
          hint="The single most profitable day in the last month."
        />
        <Metric
          label="Worst day"
          value={inr(worstDay)}
          tone="bad"
          hint="The single most costly day in the last month - hard stops keep this bounded."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Book equity curve
            </h3>
            <span className="font-mono text-[11px] text-faint">
              {d.equitySeries.length} snapshots
            </span>
          </div>
          <div className="p-4">
            <EquityCurve
              points={d.equityVals}
              fmt={inr}
              xTicks={equityXTicks}
              hwm
              ddShade
              baseline={{ value: 1000, label: "start ₹1,000" }}
              legend
              drawIn
            />
          </div>
          <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint">
            The line is the bot&apos;s balance. Gold dashes mark its best-ever
            level, and the red shading shows how far below that best it dipped
            (the drawdown).
          </p>
        </section>

        <section className="card">
          <div className="flex items-center gap-1.5 px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Win / loss · closed sells
            </h3>
            <InfoHint text="Of every trade the bot closed, how many made money. High isn't everything — a few big wins can beat many small ones." />
          </div>
          <div className="grid place-items-center p-6">
            <WinRateDonut wins={d.stats.wins} losses={d.stats.losses} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Daily realized P&L
            </h3>
            <span className="font-mono text-[11px] text-faint">
              last {d.dailyPnl.length}d
            </span>
          </div>
          <div className="p-4">
            <PnlBars
              data={d.dailyPnl.map((x) => ({
                label: shortDay(x.day),
                value: x.pnl,
              }))}
              fmt={(n) => inr(n)}
              annotateExtremes
            />
          </div>
          <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint">
            Each bar is one day&apos;s result after all fees — green above the
            line, red below. The best and worst days are labelled.
          </p>
        </section>

        <DataTable
          title="By strategy"
          head={["Strategy", "Trades", "Win%", "P&L"]}
          align={["left", "right", "right", "right"]}
          rows={d.breakdown.map((b): Cell[] => {
            const dec = b.wins + b.losses;
            return [
              strategyLabel(b.strategy),
              { v: b.trades, align: "right" },
              {
                v: dec ? `${Math.round((b.wins / dec) * 100)}%` : "-",
                align: "right",
                tone: "muted",
              },
              {
                v: `${b.pnl > 0 ? "+" : ""}${fmt(b.pnl)}`,
                align: "right",
                tone: b.pnl < 0 ? "bad" : b.pnl > 0 ? "good" : "muted",
              },
            ];
          })}
          empty="No closed trades yet."
        />
      </div>

      {/* Live market data - the one real thing on this page */}
      <PriceChart />

      <DataTable
        title="Open positions"
        head={["Strategy", "Market", "Qty", "Avg price"]}
        align={["left", "left", "right", "right"]}
        rows={d.positions.map((p): Cell[] => [
          strategyLabel(p.strategy),
          p.market,
          num(p.qty),
          num(p.avg_price),
        ])}
        empty="No open positions."
      />

      <TradesTable trades={d.trades} />

      <section className="card relative overflow-hidden px-6 py-10 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-accent/30"
        />
        <p className="eyebrow">This could be your bot</p>
        <h2 className="mx-auto mt-3 max-w-xl font-display text-2xl font-bold leading-tight tracking-tight">
          Every number above was earned in paper mode — yours starts the same
          safe way.
        </h2>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Get started free
          </Link>
          <Link
            href="/#learn"
            className="rounded-md bg-white/5 px-5 py-2.5 text-sm font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New to trading? Learn the basics
          </Link>
        </div>
      </section>
    </div>
  );
}
