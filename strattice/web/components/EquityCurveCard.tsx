"use client";
import { useMemo, useState } from "react";
import { EquityCurve } from "@/components/charts";
import { inr, shortTs, sample } from "@/lib/dashboard-format";

type Point = { ts: string; equity: number; unrealized_pnl: number };

// Real calendar windows, keyed off each snapshot's own timestamp (the supervisor writes
// them in UTC). Unlike the old fraction-of-history zoom, a "1h" here is genuinely the last
// hour whatever the poll interval is - filtering by actual timestamps can't lie. "All"
// shows everything loaded.
const WINDOWS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "6h", ms: 6 * 60 * 60_000 },
  { label: "1d", ms: 24 * 60 * 60_000 },
  { label: "All", ms: Number.POSITIVE_INFINITY },
] as const;

// Snapshot ts is UTC "YYYY-MM-DD HH:MM:SS" (occasionally already zoned); pin it to UTC
// before parsing so window math doesn't drift by the viewer's offset.
function tsMs(ts: string): number {
  return Date.parse(
    ts.replace(" ", "T") + (/[Z+]/.test(ts.slice(10)) ? "" : "Z"),
  );
}

export function EquityCurveCard({
  series,
  showSetup,
}: {
  series: Point[];
  showSetup: boolean;
}) {
  const [winMs, setWinMs] = useState<number>(Number.POSITIVE_INFINITY);

  const windowed = useMemo(() => {
    if (!Number.isFinite(winMs)) return series;
    const cutoff = Date.now() - winMs;
    const w = series.filter((s) => tsMs(s.ts) >= cutoff);
    // A just-picked short window with < 2 points would blank the chart; fall back to the
    // last couple of snapshots so it always draws something.
    return w.length >= 2 ? w : series.slice(-2);
  }, [series, winMs]);

  const equityVals = windowed.map((s) => s.equity);
  const unrealVals = windowed.map((s) => s.unrealized_pnl ?? 0);
  const labels = windowed.map((s) => shortTs(s.ts));
  const xTicks = sample(labels, 5);

  return (
    <section className="card lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Book equity &amp; unrealized P&amp;L
        </h3>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Chart time range"
        >
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              aria-pressed={winMs === w.ms}
              onClick={() => setWinMs(w.ms)}
              className={[
                "rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                winMs === w.ms
                  ? "bg-accent/15 text-accent"
                  : "text-faint hover:text-dim",
              ].join(" ")}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Book equity
          </div>
          <EquityCurve
            points={equityVals}
            fmt={inr}
            xTicks={xTicks}
            pointLabels={labels}
            hwm
            ddShade
            baseline={{ value: 1000, label: "start ₹1,000" }}
            legend
            drawIn
            emptySub="No history yet - the chart starts filling in after the bot's first check-in."
            emptyAction={
              showSetup ? { href: "/account", label: "Finish setup" } : undefined
            }
          />
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Unrealized P&amp;L
          </div>
          <EquityCurve
            points={unrealVals}
            height={130}
            fmt={inr}
            xTicks={xTicks}
            pointLabels={labels}
            baseline={{ value: 0, label: "break-even ₹0" }}
            emptySub="Marks to market once you hold an open position."
          />
        </div>
      </div>

      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint [html.pro_&]:hidden">
        Top line is the bot&apos;s cash balance; gold dashes mark its best-ever
        level and red shading the drawdown from it. Below, unrealized P&amp;L is
        the running gain or loss on positions still open - add it to book equity
        for full net worth. Hover any point for its value; use the range buttons
        to zoom by time.
      </p>
    </section>
  );
}
