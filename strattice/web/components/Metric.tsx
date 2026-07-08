import { InfoHint } from "@/components/InfoHint";

/** Compact labelled figure used in the dashboard's technical strip, the tax
 *  card and the demo page. `hint` adds a plain-English "?" explainer. */
export function Metric({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "default";
  hint?: string;
}) {
  const c =
    tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-fg";
  return (
    <div className="card px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${c}`}>
        {value}
      </div>
    </div>
  );
}
