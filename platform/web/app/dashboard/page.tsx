import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Cell } from "@/components/DataTable";
import { strategyLabel } from "@/lib/strategies";

export const dynamic = "force-dynamic";

function fmt(n: number) { return n.toFixed(2); }
function num(n: number): Cell { return { v: fmt(n), align: "right" }; }
function pnl(n: number): Cell {
  return { v: `${n > 0 ? "+" : ""}${fmt(n)}`, tone: n < 0 ? "bad" : n > 0 ? "good" : "muted", align: "right" };
}
function side(s: string): Cell {
  const buy = s?.toUpperCase() === "BUY";
  return { v: s?.toUpperCase() ?? s, tone: buy ? "good" : "bad" };
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [tier, bot, equity, positions, trades] = await Promise.all([
    q.effectiveTier(user.id), q.getBotState(user.id), q.latestEquity(user.id),
    q.openPositions(user.id), q.recentTrades(user.id, 30),
  ]);
  const hbAge = bot.last_heartbeat ? Date.now() / 1000 - bot.last_heartbeat : null;
  const healthy = hbAge !== null && hbAge < 120;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <span className="rounded-md border border-line bg-panel px-3 py-1 font-mono text-xs uppercase tracking-wider text-dim">
          {tier.name} plan
        </span>
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
          value={equity ? `₹${fmt(equity.equity)}` : "-"}
          sub={equity ? `free ₹${fmt(equity.free)}` : ""}
        />
        <StatCard
          label="Trades today"
          value={`${equity?.trades_today ?? 0} / ${tier.tradesPerDay}`}
          sub="cap by plan"
        />
        <StatCard
          label="Realized today"
          value={equity ? `₹${fmt(equity.realized_today)}` : "-"}
          tone={equity && equity.realized_today < 0 ? "bad" : equity && equity.realized_today > 0 ? "good" : "default"}
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

      <DataTable
        title="Open positions"
        head={["Strategy", "Market", "Qty", "Avg price"]}
        align={["left", "left", "right", "right"]}
        rows={positions.map((p: any): Cell[] => [
          strategyLabel(p.strategy), p.market, num(p.qty), num(p.avg_price),
        ])}
        empty="No open positions."
      />

      <DataTable
        title="Recent trades"
        head={["Time", "Strategy", "Market", "Side", "Qty", "Price", "P&L"]}
        align={["left", "left", "left", "left", "right", "right", "right"]}
        rows={trades.map((t: any): Cell[] => [
          { v: t.ts?.slice(0, 19).replace("T", " ") ?? "", tone: "muted" },
          strategyLabel(t.strategy), t.market, side(t.side),
          num(t.qty), num(t.price), pnl(t.realized_pnl),
        ])}
        empty="No trades yet."
      />
    </div>
  );
}
