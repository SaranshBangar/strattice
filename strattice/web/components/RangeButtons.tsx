"use client";

// Segmented time-window control shared by the dashboard's charts. Options are
// the standard timeframe set (lib/timeframes.ts) - callers pass the subset
// their data can fill, so every chart shows the same 1H/6H/1D/… vocabulary.
export interface RangeOption {
  key: string;
  label: string;
}

export function RangeButtons({
  value,
  options,
  onChange,
}: {
  value: string;
  options: RangeOption[];
  onChange: (key: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="Chart time range"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={[
            "rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            value === o.key
              ? "bg-accent/15 text-accent"
              : "text-faint hover:text-dim",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
