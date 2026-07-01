import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Cell } from "@/components/DataTable";
import { TradesTable, type Trade } from "@/components/TradesTable";
import { PriceChart } from "@/components/PriceChart";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EquityCurve, PnlBars, WinRateDonut, Sparkline } from "@/components/charts";
import { strategyLabel } from "@/lib/strategies";

export const dynamic = "force-dynamic";

function fmt(n: number) { return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }); }
function inr(n: number) { return `₹${fmt(n)}`; }
function num(n: number): Cell { return { v: fmt(n), align: "right" }; }
function shortDay(d: string) { return d?.slice(5) ?? d; } // MM-DD
function shortTs(ts: string) { return ts?.slice(0, 16).replace("T", " ") ?? ""; }

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
  const full = tier.dashboard === "full";
  const tradeRows = trades as unknown as Trade[];
  const equityVals = series.map((s) => s.equity);
  const decided = stats.wins + stats.losses;
  const userMarkets = Array.from(new Set(strategies.map((s) => s.market)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
          <AutoRefresh />
          <span className="rounded-md border border-line bg-panel px-3 py-1 font-mono text-xs uppercase tracking-wider text-dim">
            {tier.name} plan
          </span>
        </div>
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

      {full ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-line bg-panel lg:col-span-2">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Equity curve</h3>
                <span className="font-mono text-[11px] text-faint">{series.length} snapshots</span>
              </div>
              <div className="p-4">
                <EquityCurve
                  points={equityVals}
                  fmt={inr}
                  labels={series.length > 1 ? [shortTs(series[0].ts), shortTs(series[series.length - 1].ts)] : undefined}
                />
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
        </>
      ) : (
        <section className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line bg-panel px-4 py-5">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">Analytics dashboard</h3>
          <p className="text-sm text-muted">
            Equity curve, daily P&L, win-rate and per-strategy breakdown are part of the Plus plan and above.
          </p>
          <Link href="/billing" className="mt-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi">
            Upgrade to unlock
          </Link>
        </section>
      )}

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
