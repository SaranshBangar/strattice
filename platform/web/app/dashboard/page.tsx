import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Cell } from "@/components/DataTable";
import { TradesTable, type Trade } from "@/components/TradesTable";
import { PriceChart } from "@/components/PriceChart";
import { ProToggle } from "@/components/ProToggle";
import {
  EquityCurve,
  PnlBars,
  WinRateDonut,
  Sparkline,
  DrawdownCurve,
  PnlHistogram,
} from "@/components/charts";
import { strategyLabel } from "@/lib/strategies";
import { usdRate } from "@/lib/fx";
import { currencySymbol } from "@/lib/currencies";

export const dynamic = "force-dynamic";

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
} // MM-DD
function shortTs(ts: string) {
  return ts?.slice(0, 16).replace("T", " ") ?? "";
}

// Evenly pick k items (endpoints included) from an array - for axis tick labels.
function sample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr;
  return Array.from(
    { length: k },
    (_, j) => arr[Math.round((j * (arr.length - 1)) / (k - 1))],
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "default";
}) {
  const c =
    tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-fg";
  return (
    <div className="card px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${c}`}>
        {value}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const fy = q.financialYear();
  const [
    tier,
    bot,
    equity,
    positions,
    trades,
    series,
    daily,
    breakdown,
    stats,
    strategies,
    creds,
    tax,
  ] = await Promise.all([
    q.effectiveTier(user.id),
    q.getBotState(user.id),
    q.latestEquity(user.id),
    q.openPositions(user.id),
    q.recentTrades(user.id, 500),
    q.equitySeries(user.id, 240),
    q.dailyPnl(user.id, 30),
    q.strategyBreakdown(user.id),
    q.tradeStats(user.id),
    q.listStrategies(user.id),
    q.credentialsLinked(user.id),
    q.taxSummary(user.id, fy.startISO, fy.endISO),
  ]);
  const currency = await q.getCurrency(user.id);
  const rate = (await usdRate(currency)) ?? 1;
  const fx = { symbol: currencySymbol(currency), rate };

  const hbAge = bot.last_heartbeat
    ? Date.now() / 1000 - bot.last_heartbeat
    : null;
  const healthy = hbAge !== null && hbAge < 120;
  const tradeRows = trades as unknown as Trade[];
  const equityVals = series.map((s) => s.equity);
  const decided = stats.wins + stats.losses;
  const userMarkets = Array.from(new Set(strategies.map((s) => s.market)));

  // --- Pro-view technical metrics (computed from data already loaded above) ---
  const equityXTicks = sample(
    series.map((s) => shortTs(s.ts)),
    5,
  );
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
  const grossLoss = Math.abs(
    dv.filter((v) => v < 0).reduce((a, b) => a + b, 0),
  );
  const profitFactor = grossLoss
    ? grossWin / grossLoss
    : grossWin > 0
      ? Infinity
      : 0;
  const bestDay = dv.length ? Math.max(...dv) : 0;
  const worstDay = dv.length ? Math.min(...dv) : 0;
  const avgDay = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : 0;
  const vol =
    dv.length > 1
      ? Math.sqrt(
          dv.reduce((a, b) => a + (b - avgDay) ** 2, 0) / (dv.length - 1),
        )
      : 0;
  const sharpe = vol > 0 ? (avgDay / vol) * Math.sqrt(365) : null;
  const winRate = decided ? (stats.wins / decided) * 100 : 0;
  // Real money and paper money never share a headline: live P&L leads once live
  // trades exist; until then the card says plainly that everything is simulated.
  const hasLive = stats.liveTrades > 0;

  // Onboarding: the three things that must be true before the bot can trade.
  const setupSteps: {
    done: boolean;
    label: string;
    hint: string;
    href: string;
  }[] = [
    {
      done: creds.linked,
      label: "Link your CoinDCX API keys",
      hint: "Trading on, withdrawals off. Stored encrypted.",
      href: "/account",
    },
    {
      done: strategies.length > 0,
      label: "Add a strategy",
      hint: "Preview entries and exits on live data first.",
      href: "/strategies",
    },
    {
      done: !!bot.active,
      label: "Turn the bot on",
      hint: "Starts in DRY_RUN - no real orders until you go live.",
      href: "/account",
    },
  ];
  const setupDone = setupSteps.filter((s) => s.done).length;
  const showSetup = setupDone < setupSteps.length;
  // Equity snapshots are written by the supervisor in UTC ("YYYY-MM-DD HH:MM:SS").
  const equityAsOf = equity
    ? new Date(
        equity.ts.replace(" ", "T") +
          (/[Z+]/.test(equity.ts.slice(10)) ? "" : "Z"),
      ).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      }) + " IST"
    : null;
  const heartbeat = bot.last_heartbeat
    ? new Date(bot.last_heartbeat * 1000).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
          <p className="mt-0.5 font-mono text-[11px] text-faint">
            {heartbeat
              ? `last engine heartbeat ${heartbeat} IST`
              : "engine has not reported yet"}
          </p>
        </div>
        <ProToggle />
      </div>

      {showSetup && (
        <section className="overflow-hidden card">
          <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              setup
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {setupDone} / {setupSteps.length} done
            </span>
          </div>
          <ol>
            {setupSteps.map((s, i) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-inset/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  {s.done ? (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gain/15 text-gain">
                      <svg
                        viewBox="0 0 20 20"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m5 10.5 3 3 7-7"
                        />
                      </svg>
                    </span>
                  ) : (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 font-mono text-[10px] text-faint">
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={[
                        "text-sm font-medium",
                        s.done
                          ? "text-muted line-through decoration-line"
                          : "text-fg",
                      ].join(" ")}
                    >
                      {s.label}
                    </div>
                    {!s.done && (
                      <div className="mt-0.5 text-xs text-muted">{s.hint}</div>
                    )}
                  </div>
                  {!s.done && (
                    <span
                      aria-hidden="true"
                      className="font-mono text-sm text-faint"
                    >
                      →
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bot"
          value={bot.active ? (healthy ? "Running" : "Stalled") : "Off"}
          sub={bot.live ? "LIVE" : "DRY_RUN"}
          tone={bot.active ? (healthy ? "good" : "warn") : "default"}
        />
        {/* The supervisor computes this as ₹1,000 paper base + realized P&L - a book
            figure, not the user's exchange balance. Say so on the card, not in fine print. */}
        <StatCard
          label="Book equity"
          value={equity ? inr(equity.equity) : "-"}
          sub={
            equity
              ? `₹1,000 paper base + realized P&L · as of ${equityAsOf}`
              : ""
          }
          chart={
            equityVals.length > 1 ? <Sparkline data={equityVals} /> : undefined
          }
        />
        <StatCard
          label="Realized today"
          value={equity ? inr(equity.realized_today) : "-"}
          sub={`${equity?.trades_today ?? 0} / ${tier.tradesPerDay} trades`}
          tone={
            equity && equity.realized_today < 0
              ? "bad"
              : equity && equity.realized_today > 0
                ? "good"
                : "default"
          }
        />
        {hasLive ? (
          <StatCard
            label="Net P&L (live)"
            value={inr(stats.livePnl)}
            sub={`${stats.liveTrades} live fills · paper ${inr(stats.paperPnl)}`}
            tone={
              stats.livePnl < 0 ? "bad" : stats.livePnl > 0 ? "good" : "default"
            }
          />
        ) : (
          <StatCard
            label="Paper P&L (all-time)"
            value={inr(stats.paperPnl)}
            sub={`${stats.paperTrades} DRY_RUN fills · no live trades yet`}
            tone={
              stats.paperPnl < 0
                ? "bad"
                : stats.paperPnl > 0
                  ? "good"
                  : "default"
            }
          />
        )}
      </div>
      <p className="font-mono text-[11px] leading-relaxed text-faint">
        P&amp;L is net of exchange fees and GST. TDS (1% on every sell) is a
        cash withholding tracked separately, not a cost inside P&amp;L. Win rate
        counts closed sells only. Book equity is the engine&apos;s ledger
        (₹1,000 paper base + realized P&amp;L), not your CoinDCX wallet balance
        - check the exchange for actual funds.
      </p>

      {/* Pro-view technical strip - hidden until "Pro view" is toggled on. */}
      <div className="hidden space-y-2 [html.pro_&]:block">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-faint">
          Technical metrics · last {daily.length}d
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Metric
            label="Win rate"
            value={decided ? `${winRate.toFixed(0)}%` : "-"}
          />
          <Metric
            label="Max drawdown"
            value={`-${maxDD.toFixed(1)}%`}
            tone={maxDD > 0 ? "bad" : "default"}
          />
          <Metric
            label="Profit factor"
            value={profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
            tone={
              profitFactor >= 1 ? "good" : profitFactor > 0 ? "bad" : "default"
            }
          />
          <Metric
            label="Avg / day"
            value={inr(avgDay)}
            tone={avgDay < 0 ? "bad" : avgDay > 0 ? "good" : "default"}
          />
          <Metric
            label="Best day"
            value={inr(bestDay)}
            tone={bestDay > 0 ? "good" : "default"}
          />
          <Metric
            label="Worst day"
            value={inr(worstDay)}
            tone={worstDay < 0 ? "bad" : "default"}
          />
          <Metric label="σ / day" value={inr(vol)} />
          <Metric
            label="Sharpe (ann.)"
            value={sharpe === null ? "-" : sharpe.toFixed(2)}
            tone={
              sharpe === null
                ? "default"
                : sharpe >= 1
                  ? "good"
                  : sharpe < 0
                    ? "bad"
                    : "default"
            }
          />
        </div>
      </div>

      {bot.last_error && (
        <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          Engine error: {bot.last_error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Book equity curve
            </h3>
            <span className="font-mono text-[11px] text-faint">
              {series.length} snapshots
            </span>
          </div>
          <div className="p-4">
            <EquityCurve points={equityVals} fmt={inr} xTicks={equityXTicks} />
          </div>
        </section>

        <section className="card">
          <div className="px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Win / loss · closed sells
            </h3>
          </div>
          <div className="grid place-items-center p-6">
            <WinRateDonut wins={stats.wins} losses={stats.losses} />
          </div>
        </section>
      </div>

      {/* Drawdown + P&L distribution - pro-view only. */}
      <div className="hidden grid-cols-1 gap-4 lg:grid-cols-2 [html.pro_&]:grid">
        <section className="card">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Drawdown from peak
            </h3>
            <span className="font-mono text-[11px] text-faint">
              max -{maxDD.toFixed(1)}%
            </span>
          </div>
          <div className="p-4">
            <DrawdownCurve
              points={ddSeries.map((v) => -v)}
              xTicks={equityXTicks}
            />
          </div>
          <p className="px-4 py-2 text-[11px] leading-relaxed text-faint">
            How far below its own peak the account sat at each moment - depth
            and recovery time matter more than any single losing day.
          </p>
        </section>

        <section className="card">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Daily P&amp;L distribution
            </h3>
            <span className="font-mono text-[11px] text-faint">
              last {daily.length}d
            </span>
          </div>
          <div className="p-4">
            <PnlHistogram values={dv} fmt={(n) => inr(n)} />
          </div>
          <p className="px-4 py-2 text-[11px] leading-relaxed text-faint">
            The shape of your days: a healthy system clusters small red days
            left of zero with a longer green tail to the right.
          </p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              Daily realized P&L
            </h3>
            <span className="font-mono text-[11px] text-faint">
              last {daily.length}d
            </span>
          </div>
          <div className="p-4">
            <PnlBars
              data={daily.map((d) => ({
                label: shortDay(d.day),
                value: d.pnl,
              }))}
              fmt={(n) => inr(n)}
            />
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

      <PriceChart markets={userMarkets} fx={fx} />

      <DataTable
        title="Open positions"
        head={["Strategy", "Market", "Qty", "Avg price"]}
        align={["left", "left", "right", "right"]}
        rows={positions.map((p: any): Cell[] => [
          strategyLabel(p.strategy),
          p.market,
          num(p.qty),
          num(p.avg_price),
        ])}
        empty="No open positions."
      />

      <TradesTable trades={tradeRows} />

      {/* Tax ledger - LIVE sells only; paper trades are never tax events. */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
            Tax · {fy.label}{" "}
            <span className="font-mono text-[11px] font-normal text-faint">
              India VDA
            </span>
          </h3>
          {tax.sells > 0 && (
            <a
              href="/api/tax-report"
              className="rounded-md bg-white/5 px-2.5 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Download sell ledger (CSV)
            </a>
          )}
        </div>
        {tax.sells === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            No live sells this financial year - nothing taxable yet. DRY_RUN
            fills are simulations and never create a tax liability.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-5">
              <Metric label="Live sells" value={String(tax.sells)} />
              <Metric
                label="Sale consideration"
                value={inr(tax.consideration)}
              />
              <Metric
                label="Realized gains"
                value={inr(tax.gains)}
                tone={tax.gains > 0 ? "good" : "default"}
              />
              <Metric
                label="Realized losses"
                value={inr(tax.losses)}
                tone={tax.losses < 0 ? "bad" : "default"}
              />
              <Metric label="TDS withheld" value={inr(tax.tds)} />
            </div>
            <p className="px-4 py-2.5 text-[11px] leading-relaxed text-faint">
              Indicative only, not tax advice. VDA gains are taxed flat at 30%
              under section 115BBH and losses cannot be offset against gains;
              TDS withheld under section 194S is a credit you claim when filing.
              The CSV lists every live sell for your records.
            </p>
          </>
        )}
      </section>

      {tradeRows.length >= 500 && (
        <p className="text-center font-mono text-[11px] text-faint">
          Showing the most recent 500 trades.
        </p>
      )}
    </div>
  );
}
