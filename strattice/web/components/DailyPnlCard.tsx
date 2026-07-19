"use client";
import { useMemo, useState } from "react";
import { PnlBars } from "@/components/charts";
import { inr, shortDay } from "@/lib/dashboard-format";
import { RangeButtons } from "@/components/RangeButtons";
import { timeframe, timeframesFor, sliceByTime } from "@/lib/timeframes";

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function DailyPnlCard({
  daily,
}: {
  daily: { day: string; pnl: number }[];
}) {
  const [win, setWin] = useState("all");
  // Data is bucketed per calendar day, so only day-scale standard windows apply.
  const options = useMemo(() => {
    const span =
      daily.length >= 2
        ? dayMs(daily[daily.length - 1].day) - dayMs(daily[0].day)
        : 0;
    return timeframesFor(span).filter((t) => t.ms === null || t.ms >= 7 * DAY_MS);
  }, [daily]);
  const windowed = useMemo(
    () => sliceByTime(daily, (d) => dayMs(d.day), timeframe(win)),
    [daily, win],
  );

  return (
    <section className="card lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Daily realized P&L
        </h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            last {windowed.length}d
          </span>
          <RangeButtons
            value={win}
            options={options.map((t) => ({ key: t.key, label: t.label }))}
            onChange={setWin}
          />
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
