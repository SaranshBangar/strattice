import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Cell } from "@/components/DataTable";
import { TradesTable, type Trade } from "@/components/TradesTable";
import { PriceChart } from "@/components/PriceChart";
import { ProToggle } from "@/components/ProToggle";
import { EquityCurve, PnlBars, WinRateDonut, Sparkline } from "@/components/charts";
import { strategyLabel } from "@/lib/strategies";

export const dynamic = "force-dynamic";

function fmt(n: number) { return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }); }
function inr(n: number) { return `₹${fmt(n)}`; }
function num(n: number): Cell { return { v: fmt(n), align: "right" }; }
function shortDay(d: string) { return d?.slice(5) ?? d; } // MM-DD
function shortTs(ts: string) { return ts?.slice(0, 16).replace("T", " ") ?? ""; }

// Evenly pick k items (endpoints included) from an array — for axis tick labels.
function sample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr;
  return Array.from({ length: k }, (_, j) => arr[Math.round((j * (arr.length - 1)) / (k - 1))]);
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "good" | "bad" | "default" }) {
  const c = tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-fg";
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [tier, bot, equity, positions, trades, series, daily, breakdown, stats, strategies] = await Promise.all([
    q.effectiveTier(user.id), q.getBotState(user.id), q.latestEquity(user.id),
    q.openPositions(user.id), q.recentTrades(user.id, 500),
    q.equitySeries(user.id, 240), q.dailyPnl(user.id, 30),
    q.strategyBreakdown(user.id), q.tradeStats(user.id), q.listStrategies(user.id),
  ]);

  const hbAge = bot.last_heartbeat ? Date.now() / 1000 - bot.last_heartbeat : null;
  const healthy = hbAge !== null && hbAge < 120;
  const tradeRows = trades as unknown as Trade[];
  const equityVals = series.map((s) => s.equity);
  const decided = stats.wins + stats.losses;
  const userMarkets = Array.from(new Set(strategies.map((s) => s.market)));

  // --- Pro-view technical metrics (computed from data already loaded above) ---
  const equityXTicks = sample(series.map((s) => shortTs(s.ts)), 5);
  // Max drawdown: largest peak-to-trough drop across the equity curve.
  let peak = -Infinity;
  let maxDD = 0;
  const ddSeries = equityVals.map((v) => {
    peak = Math.max(peak, v);
    const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    return -dd; // plotted as a non-positive line
  });
  const dv = daily.map((d) => d.pnl);
  const grossWin = dv.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(dv.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const bestDay = dv.length ? Math.max(...dv) : 0;
  const worstDay = dv.length ? Math.min(...dv) : 0;
  const avgDay = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : 0;
  const vol = dv.length > 1 ? Math.sqrt(dv.reduce((a, b) => a + (b - avgDay) ** 2, 0) / (dv.length - 1)) : 0;
  const winRate = decided ? (stats.wins / decided) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <ProToggle />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bot"
          value={bot.active ? (healthy ? "Running" : "Stalled") : "Off"}
          sub={bot.live ? "LIVE" : "DRY_RUN"}
          tone={bot.active ? (healthy ? "good" : "warn") : "default"}
        />
        <StatCard
          label="Equity"
          value={equity ? inr(equity.equity) : "-"}
          sub={equity ? `free ${inr(equity.free)}` : ""}
          chart={equityVals.length > 1 ? <Sparkline data={equityVals} /> : undefined}
        />
        <StatCard
          label="Realized today"
          value={equity ? inr(equity.realized_today) : "-"}
          sub={`${equity?.trades_today ?? 0} / ${tier.tradesPerDay} trades`}
          tone={equity && equity.realized_today < 0 ? "bad" : equity && equity.realized_today > 0 ? "good" : "default"}
        />
        <StatCard
          label="Net P&L (all-time)"
          value={inr(stats.pnl)}
          sub={`${stats.total} trades · TDS ${inr(stats.tds)}`}
          tone={stats.pnl < 0 ? "bad" : stats.pnl > 0 ? "good" : "default"}
        />
      </div>

      {/* Pro-view technical strip — hidden until "Pro view" is toggled on. */}
      <div className="hidden space-y-2 [html.pro_&]:block">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-faint">Technical metrics · last {daily.length}d</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Metric label="Win rate" value={decided ? `${winRate.toFixed(0)}%` : "-"} />
          <Metric label="Max drawdown" value={`-${maxDD.toFixed(1)}%`} tone={maxDD > 0 ? "bad" : "default"} />
          <Metric label="Profit factor" value={profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)} tone={profitFactor >= 1 ? "good" : profitFactor > 0 ? "bad" : "default"} />
          <Metric label="Avg / day" value={inr(avgDay)} tone={avgDay < 0 ? "bad" : avgDay > 0 ? "good" : "default"} />
          <Metric label="Best day" value={inr(bestDay)} tone={bestDay > 0 ? "good" : "default"} />
          <Metric label="Worst day" value={inr(worstDay)} tone={worstDay < 0 ? "bad" : "default"} />
          <Metric label="σ / day" value={inr(vol)} />
          <Metric label="Trades" value={String(stats.total)} />
        </div>
      </div>

      {bot.last_error && (
        <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          Engine error: {bot.last_error}
        </p>
      )}
      {!bot.active && (
        <p className="text-sm text-muted">
          Bot is off. <Link href="/account" className="text-accent underline-offset-2 hover:underline">Link your CoinDCX account and turn it on.</Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-panel lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Equity curve</h3>
            <span className="font-mono text-[11px] text-faint">{series.length} snapshots</span>
          </div>
          <div className="p-4">
            <EquityCurve points={equityVals} fmt={inr} xTicks={equityXTicks} />
          </div>
        </section>

        <section className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Win / loss</h3>
          </div>
          <div className="grid place-items-center p-6">
            <WinRateDonut wins={stats.wins} losses={stats.losses} />
          </div>
        </section>
      </div>

      {/* Drawdown curve — pro-view only. */}
      <section className="hidden rounded-lg border border-line bg-panel [html.pro_&]:block">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Drawdown</h3>
          <span className="font-mono text-[11px] text-faint">peak-to-trough · max -{maxDD.toFixed(1)}%</span>
        </div>
        <div className="p-4">
          <EquityCurve points={ddSeries.length > 1 ? ddSeries : []} fmt={(n) => `${n.toFixed(1)}%`} xTicks={equityXTicks} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-panel lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Daily realized P&L</h3>
            <span className="font-mono text-[11px] text-faint">last {daily.length}d</span>
          </div>
          <div className="p-4">
            <PnlBars data={daily.map((d) => ({ label: shortDay(d.day), value: d.pnl }))} fmt={(n) => inr(n)} />
          </div>
        </section>

        <DataTable
          title="By strategy"
          head={["Strategy", "Trades", "Win%", "P&L"]}
          align={["left", "right", "right", "right"]}
          rows={breakdown.map((b): Cell[] => {
            const dec = b.wins + b.losses;
            return [
              strategyLabel(b.strategy),
              { v: b.trades, align: "right" },
              { v: dec ? `${Math.round((b.wins / dec) * 100)}%` : "-", align: "right", tone: "muted" },
              { v: `${b.pnl > 0 ? "+" : ""}${fmt(b.pnl)}`, align: "right", tone: b.pnl < 0 ? "bad" : b.pnl > 0 ? "good" : "muted" },
            ];
          })}
          empty="No closed trades yet."
        />
      </div>

      <PriceChart markets={userMarkets} />

      <DataTable
        title="Open positions"
        head={["Strategy", "Market", "Qty", "Avg price"]}
        align={["left", "left", "right", "right"]}
        rows={positions.map((p: any): Cell[] => [
          strategyLabel(p.strategy), p.market, num(p.qty), num(p.avg_price),
        ])}
        empty="No open positions."
      />

      <TradesTable trades={tradeRows} />

      {tradeRows.length >= 500 && (
        <p className="text-center font-mono text-[11px] text-faint">Showing the most recent 500 trades.</p>
      )}
    </div>
  );
}
