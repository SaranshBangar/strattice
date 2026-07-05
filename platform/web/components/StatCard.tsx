import type { ReactNode } from "react";

export type StatCardTone = "default" | "good" | "bad" | "warn";

export type StatCardProps = {
  label: string;
  value: string;
  sub?: string;
  tone?: StatCardTone;
  /** Optional visual (e.g. a sparkline) rendered under the value. */
  chart?: ReactNode;
};

const valueTone: Record<StatCardTone, string> = {
  default: "text-fg",
  good: "text-gain",
  bad: "text-loss",
  warn: "text-warn",
};

export function StatCard({ label, value, sub, tone = "default", chart }: StatCardProps) {
  return (
    <div className="flex flex-col card p-4">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={["mt-2 font-mono text-2xl font-semibold tnum tracking-tight", valueTone[tone]].join(" ")}>
        {value}
      </div>
      {sub && <div className="mt-1 font-mono text-xs text-muted">{sub}</div>}
      {chart && <div className="mt-3">{chart}</div>}
    </div>
  );
}
