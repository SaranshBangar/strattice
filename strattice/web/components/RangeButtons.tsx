"use client";

// Zoom control for the dashboard's time-series charts. Windows are relative
// (fractions of whatever history is loaded), not fixed calendar spans - the
// bot's poll interval isn't fixed, so a literal "7D" label could lie.
const WINDOWS = [
  { label: "25%", frac: 0.25 },
  { label: "50%", frac: 0.5 },
  { label: "All", frac: 1 },
] as const;

export function RangeButtons({
  frac,
  onChange,
}: {
  frac: number;
  onChange: (frac: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Chart time range">
      {WINDOWS.map((w) => (
        <button
          key={w.label}
          type="button"
          aria-pressed={frac === w.frac}
          onClick={() => onChange(w.frac)}
          className={[
            "rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            frac === w.frac
              ? "bg-accent/15 text-accent"
              : "text-faint hover:text-dim",
          ].join(" ")}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}
