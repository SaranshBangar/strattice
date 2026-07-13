"use client";
import { useMemo, useState } from "react";
import { DrawdownCurve } from "@/components/charts";
import { shortTs, sample } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";

export function DrawdownCard({
  series,
}: {
  series: { ts: string; equity: number }[];
}) {
  const [frac, setFrac] = useState(1);
  const windowed = useMemo(() => {
    const n = Math.max(2, Math.round(series.length * frac));
    return series.slice(-n);
  }, [series, frac]);

  // Drawdown relative to the peak within the visible window, not the account's
  // all-time peak - zooming into a recent slice should show that slice's own dip.
  const { ddSeries, maxDD, labels } = useMemo(() => {
    let peak = -Infinity;
    let maxDD = 0;
    const dd = windowed.map((s) => {
      peak = Math.max(peak, s.equity);
      const d = peak > 0 ? ((peak - s.equity) / peak) * 100 : 0;
      maxDD = Math.max(maxDD, d);
      return d;
    });
    return { ddSeries: dd, maxDD, labels: windowed.map((s) => shortTs(s.ts)) };
  }, [windowed]);
  const xTicks = sample(labels, 5);

  return (
    <section className="card">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Drawdown from peak
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            max -{maxDD.toFixed(1)}%
          </span>
          <RangeButtons frac={frac} onChange={setFrac} />
        </div>
      </div>
      <div className="p-4">
        <DrawdownCurve
          points={ddSeries}
          xTicks={xTicks}
          pointLabels={labels}
          guide
        />
      </div>
      <p className="px-4 py-2 text-[11px] leading-relaxed text-faint">
        How far below its own peak the account sat at each moment - depth
        and recovery time matter more than any single losing day.
      </p>
    </section>
  );
}
