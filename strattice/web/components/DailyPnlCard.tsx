"use client";
import { useMemo, useState } from "react";
import { PnlBars } from "@/components/charts";
import { inr, shortDay } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";

export function DailyPnlCard({
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
    <section className="card lg:col-span-2">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Daily realized P&L
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            last {windowed.length}d
          </span>
          <RangeButtons frac={frac} onChange={setFrac} />
        </div>
      </div>
      <div className="p-4">
        <PnlBars
          data={windowed.map((d) => ({ label: shortDay(d.day), value: d.pnl }))}
          fmt={(n) => inr(n)}
          annotateExtremes
          emptySub="Each bar will show one day's result once the bot closes its first trade."
        />
      </div>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint [html.pro_&]:hidden">
        Each bar is one day&apos;s result after all fees — green above the
        line, red below. The best and worst days are labelled.
      </p>
    </section>
  );
}
