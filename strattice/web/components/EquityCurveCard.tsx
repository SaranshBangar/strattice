"use client";
import { useMemo, useState } from "react";
import { EquityCurve } from "@/components/charts";
import { inr, shortTs, sample } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";

export function EquityCurveCard({
  series,
  showSetup,
}: {
  series: { ts: string; equity: number }[];
  showSetup: boolean;
}) {
  const [frac, setFrac] = useState(1);
  const windowed = useMemo(() => {
    const n = Math.max(2, Math.round(series.length * frac));
    return series.slice(-n);
  }, [series, frac]);
  const equityVals = windowed.map((s) => s.equity);
  const labels = windowed.map((s) => shortTs(s.ts));
  const xTicks = sample(labels, 5);

  return (
    <section className="card lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Book equity curve
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            {windowed.length} snapshots
          </span>
          <RangeButtons frac={frac} onChange={setFrac} />
        </div>
      </div>
      <div className="p-4">
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
          emptySub="No history yet — the chart starts filling in after the bot's first check-in."
          emptyAction={
            showSetup ? { href: "/account", label: "Finish setup" } : undefined
          }
        />
      </div>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint [html.pro_&]:hidden">
        The line is the bot&apos;s balance. Gold dashes mark its best-ever
        level, and the red shading shows how far below that best it dipped
        (the drawdown). Hover a point for its exact value; use the range
        buttons to zoom.
      </p>
    </section>
  );
}
