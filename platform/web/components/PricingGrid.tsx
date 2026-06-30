import Link from "next/link";

export type PricingTier = {
  name: string;
  priceInr: number;
  tradesPerDay: number;
  perk: string;
};

export type PricingGridProps = {
  tiers: PricingTier[];
  ctaHref: string;
};

const inr = (n: number) => new Intl.NumberFormat("en-IN").format(n);

export function PricingGrid({ tiers, ctaHref }: PricingGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {tiers.map((t) => {
        const highlight = t.name.toLowerCase() === "plus";
        const free = t.priceInr === 0;
        return (
          <div
            key={t.name}
            className={[
              "flex flex-col rounded-lg border bg-panel p-5",
              highlight ? "border-accent ring-1 ring-accent/30" : "border-line",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-dim">
                {t.name}
              </h3>
              {highlight && (
                <span className="rounded-sm bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Popular
                </span>
              )}
            </div>

            <div className="mt-3 flex items-baseline gap-1">
              <span className="font-mono text-2xl font-semibold tracking-tight text-fg">
                ₹{inr(t.priceInr)}
              </span>
              <span className="text-sm text-faint">/mo</span>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted">Trades / day</dt>
                <dd className="font-mono font-medium tnum text-dim">{t.tradesPerDay}</dd>
              </div>
              <div className="border-t border-line pt-2 text-muted">{t.perk}</div>
            </dl>

            <Link
              href={ctaHref}
              className={[
                "mt-5 inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                highlight || free
                  ? "bg-accent text-accent-ink hover:bg-accent-hi"
                  : "border border-line text-dim hover:bg-inset hover:text-fg",
              ].join(" ")}
            >
              {free ? "Get started free" : "Choose " + t.name}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
