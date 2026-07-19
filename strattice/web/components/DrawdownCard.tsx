"use client";
import { useMemo, useState } from "react";
import { DrawdownCurve } from "@/components/charts";
import { shortTs, tsMs, xFractions, timeTicks } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";
import { timeframe, timeframesFor, sliceByTime } from "@/lib/timeframes";

export function DrawdownCard({
  series,
}: {
  series: { ts: string; equity: number }[];
}) {
  const [win, setWin] = useState("all");
  // Standard windows the loaded snapshots can actually fill (1H/3H/… up to ALL).
  const options = useMemo(() => {
    if (series.length < 2) return timeframesFor(0);
    const span = tsMs(series[series.length - 1].ts) - tsMs(series[0].ts);
    return timeframesFor(span);
  }, [series]);
  const windowed = useMemo(
    () => sliceByTime(series, (s) => tsMs(s.ts), timeframe(win)),
    [series, win],
  );

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
  // Time-proportional axis: consistent gaps even when poll snapshots are irregular.
  const times = windowed.map((s) => tsMs(s.ts));
  const xs = xFractions(times);
  const xTicks = timeTicks(times, 5);

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Drawdown from peak
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            max -{maxDD.toFixed(1)}%
          </span>
          <RangeButtons
            value={win}
            options={options.map((t) => ({ key: t.key, label: t.label }))}
            onChange={setWin}
          />
        </div>
      </div>
      <div className="p-4">
        <DrawdownCurve
          points={ddSeries}
          xTicks={xTicks}
          xs={xs}
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
