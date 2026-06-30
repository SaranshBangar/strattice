export type StatCardTone = "default" | "good" | "bad" | "warn";

export type StatCardProps = {
  label: string;
  value: string;
  sub?: string;
  tone?: StatCardTone;
};

const valueTone: Record<StatCardTone, string> = {
  default: "text-fg",
  good: "text-gain",
  bad: "text-loss",
  warn: "text-warn",
};

export function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={["mt-2 font-mono text-2xl font-semibold tnum tracking-tight", valueTone[tone]].join(" ")}>
        {value}
      </div>
      {sub && <div className="mt-1 font-mono text-xs text-muted">{sub}</div>}
    </div>
  );
}
