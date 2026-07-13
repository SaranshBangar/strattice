"use client";
import { useMemo, useState } from "react";
import { PnlHistogram } from "@/components/charts";
import { inr } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";

export function PnlHistogramCard({
  daily,
}: {
  daily: { day: string; pnl: number }[];
}) {
  const [frac, setFrac] = useState(1);
  const windowed = useMemo(() => {
    const n = Math.max(2, Math.round(daily.length * frac));
    return daily.slice(-n);
  }, [daily, frac]);

  return (
    <section className="card">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Daily P&amp;L distribution
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            last {windowed.length}d
          </span>
          <RangeButtons frac={frac} onChange={setFrac} />
        </div>
      </div>
      <div className="p-4">
        <PnlHistogram
          values={windowed.map((d) => d.pnl)}
          fmt={(n) => inr(n)}
        />
      </div>
      <p className="px-4 py-2 text-[11px] leading-relaxed text-faint">
        The shape of your days: a healthy system clusters small red days
        left of zero with a longer green tail to the right.
      </p>
    </section>
  );
}
