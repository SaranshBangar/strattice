"use client";
import { useMemo, useState } from "react";
import { EquityCurve } from "@/components/charts";
import { inr, shortTs, sample } from "@/lib/dashboard-format";

type Point = { ts: string; unrealized_pnl: number; realized_today: number };

// Real calendar windows, keyed off each snapshot's own timestamp (the supervisor writes
// them in UTC). Unlike a fraction-of-history zoom, a "1h" here is genuinely the last hour
// whatever the poll interval is - filtering by actual timestamps can't lie. "All" shows
// everything loaded.
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

  const unrealVals = windowed.map((s) => s.unrealized_pnl ?? 0);
  const realizedVals = windowed.map((s) => s.realized_today ?? 0);
  const labels = windowed.map((s) => shortTs(s.ts));
  const xTicks = sample(labels, 5);
  const setupAction = showSetup
    ? { href: "/account", label: "Finish setup" }
    : undefined;

  return (
    <section className="card lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Unrealized &amp; realized P&amp;L
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
            Unrealized P&amp;L · open positions
          </div>
          <EquityCurve
            points={unrealVals}
            height={150}
            fmt={inr}
            xTicks={xTicks}
            pointLabels={labels}
            baseline={{ value: 0, label: "break-even ₹0" }}
            emptySub="Marks to market once you hold an open position."
            emptyAction={setupAction}
          />
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Realized P&amp;L · today
          </div>
          <EquityCurve
            points={realizedVals}
            height={150}
            fmt={inr}
            xTicks={xTicks}
            pointLabels={labels}
            baseline={{ value: 0, label: "break-even ₹0" }}
            emptySub="Fills in as trades close and lock in profit or loss."
            emptyAction={setupAction}
          />
        </div>
      </div>

      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint [html.pro_&]:hidden">
        Unrealized P&amp;L is the running gain or loss on positions still open,
        marked to the current price - add it to book equity for full net worth.
        Realized P&amp;L is what today&apos;s closed trades locked in, after fees.
        Hover any point for its value; use the range buttons to zoom by time.
      </p>
    </section>
  );
}
