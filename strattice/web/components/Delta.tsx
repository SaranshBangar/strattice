// A signed, colour-coded numeric delta (green up / red down / muted flat). Keeps
// gain/loss styling consistent wherever a change is shown.
export function Delta({
  value,
  suffix = "",
  digits = 2,
  className = "",
}: {
  value: number;
  suffix?: string;
  digits?: number;
  className?: string;
}) {
  const tone = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-muted";
  return (
    <span className={`font-mono tnum ${tone} ${className}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}
