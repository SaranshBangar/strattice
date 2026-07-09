"use client";
// Client body of the public demo dashboard. Split out of app/demo/page.tsx so
// it can localize money to the visitor's currency (useAutoFx) without making
// the route dynamic - the page still server-renders in INR for SEO, then this
// flips once to the detected currency after mount. demoData() is deterministic,
// so the server-rendered numbers match the first client paint (no hydration
// mismatch); only the currency symbol/rate change on the follow-up render.
//
// The bot's book is genuinely INR (a CoinDCX account), so every ledger value
// stays a raw INR number and is converted at the moment of display via
// fx.inrRate. The live PriceChart is quoted in USD, so it gets fx.usdRate.
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
import type { demoData } from "@/lib/demo-data";
import { useAutoFx } from "@/lib/geo-currency";

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

// The sample data is computed once on the server (app/demo/page.tsx) and passed
// in, so the clock-derived date labels can't drift between SSR and hydration
// and demoData() never ships to the client bundle.
export function DemoDashboard({ data: d }: { data: ReturnType<typeof demoData> }) {
  const fx = useAutoFx();

  // Raw INR value -> localized string. Before detection resolves this is the
  // identity (INR, en-IN), matching the server render.
  const fmt = (n: number) =>
    (n * fx.inrRate).toLocaleString(fx.locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  const money = (n: number) => `${fx.symbol}${fmt(n)}`;
  // Bare numbers that are NOT display-currency money (coin quantity, raw price
  // reference) - formatted for the locale but never rate-converted.
  const num = (n: number): Cell => ({
    v: n.toLocaleString(fx.locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }),
    align: "right",
  });
  // The paper base, localized: "₹1,000" for an Indian visitor, "$12" abroad.
  const base = money(1000);

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

  // Live Binance prices are USD-quoted; convert with usdRate, not inrRate.
  const liveFx = fx.ready
    ? { symbol: fx.symbol, rate: fx.usdRate }
    : { symbol: "$", rate: 1 };

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
            90 days of practice trading on a {base} paper base.
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
          value={money(d.latestEquity.equity)}
          sub={`${base} paper base + realized P&L`}
          hint={`The bot's own ledger: ${base} of practice money plus everything it has won or lost — not an exchange wallet balance.`}
          chart={
            d.equityVals.length > 1 ? (
              <Sparkline data={d.equityVals} area />
            ) : undefined
          }
        />
        <StatCard
          label="Realized today"
          value={money(d.latestEquity.realized_today)}
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
          value={money(d.stats.paperPnl)}
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
          value={money(bestDay)}
          tone="good"
          hint="The single most profitable day in the last month."
        />
        <Metric
          label="Worst day"
          value={money(worstDay)}
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
              fmt={money}
              xTicks={equityXTicks}
              hwm
              ddShade
              baseline={{ value: 1000, label: `start ${base}` }}
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
              fmt={money}
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
      <PriceChart fx={liveFx} />

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
