import { InfoHint } from "@/components/InfoHint";

// Unrealized (mark-to-market on still-open positions) and realized-today sit in ONE card:
// they're the two halves of "how am I doing right now", and reading them together is the
// point - book equity + unrealized is your true net worth. No hard divider between the two
// rows (light spacing only), in keeping with the dashboard's quiet, borderless look.
type Tone = "default" | "good" | "bad";
const toneCls: Record<Tone, string> = {
  default: "text-fg",
  good: "text-gain",
  bad: "text-loss",
};
const tone = (n: number): Tone => (n < 0 ? "bad" : n > 0 ? "good" : "default");

function Row({
  label,
  sub,
  value,
  tone: t,
}: {
  label: string;
  sub: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted">{sub}</div>
      </div>
      <div
        className={[
          "shrink-0 font-mono text-xl font-semibold tnum tracking-tight",
          toneCls[t],
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

export function PnlCard({
  unrealized,
  realized,
  tradesToday,
  tradesCap,
  fmt,
  hasData = true,
}: {
  unrealized: number;
  realized: number;
  tradesToday: number;
  tradesCap?: number | string;
  /** Raw INR value -> display string (₹ or localized currency). */
  fmt: (n: number) => string;
  /** No equity snapshot yet -> show "-" instead of a fake zero. */
  hasData?: boolean;
}) {
  const trades =
    tradesCap != null ? `${tradesToday}/${tradesCap} trades` : `${tradesToday} trades`;
  return (
    <div className="flex flex-col gap-3 card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        P&amp;L
        <InfoHint text="Unrealized is paper gain or loss on positions that are still open, marked to the current price - add it to book equity for your full net worth. Realized today is what trades closed today locked in, after fees." />
      </div>
      <Row
        label="Unrealized"
        sub="open · mark-to-market"
        value={hasData ? fmt(unrealized) : "-"}
        tone={hasData ? tone(unrealized) : "default"}
      />
      <Row
        label="Realized today"
        sub={trades}
        value={hasData ? fmt(realized) : "-"}
        tone={hasData ? tone(realized) : "default"}
      />
    </div>
  );
}
