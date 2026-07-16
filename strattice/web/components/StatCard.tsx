import type { ReactNode } from "react";
import { InfoHint } from "@/components/InfoHint";

export type StatCardTone = "default" | "good" | "bad" | "warn";

export type StatCardProps = {
  label: string;
  value: string;
  sub?: string;
  tone?: StatCardTone;
  /** Optional visual (e.g. a sparkline) rendered under the value. */
  chart?: ReactNode;
  /** Render the chart full-bleed at the card's bottom edge (edge to edge) instead of
   *  inset under the value. For sparklines meant to anchor the whole card. */
  chartBleed?: boolean;
  /** Plain-English "?" explainer beside the label. */
  hint?: string;
};

const valueTone: Record<StatCardTone, string> = {
  default: "text-fg",
  good: "text-gain",
  bad: "text-loss",
  warn: "text-warn",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  chart,
  chartBleed = false,
  hint,
}: StatCardProps) {
  return (
    <div className="flex flex-col card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
      <div
        className={[
          "mt-2 font-mono text-2xl font-semibold tnum tracking-tight",
          valueTone[tone],
        ].join(" ")}
      >
        {value}
      </div>
      {sub && <div className="mt-1 font-mono text-xs text-muted">{sub}</div>}
      {chart &&
        (chartBleed ? (
          // -mx-4/-mb-4 cancel the card's p-4 so the chart reaches the card edges; the
          // container is rounded + clipped itself (the card isn't overflow-hidden, so its
          // "?" tooltips can still escape).
          <div className="-mx-4 -mb-4 mt-auto overflow-hidden rounded-b-xl pt-3">
            {chart}
          </div>
        ) : (
          <div className="mt-3">{chart}</div>
        ))}
    </div>
  );
}
