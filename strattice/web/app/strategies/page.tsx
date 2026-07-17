import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StrategyManager } from "@/components/StrategyManager";
import { StrategyQuiz } from "@/components/StrategyQuiz";
import { DcaPreview } from "@/components/DcaPreview";
import { DCA_META } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [tier, strategies, breakdown] = await Promise.all([
    q.effectiveTier(user.id),
    q.listStrategies(user.id),
    q.strategyBreakdown(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Strategies
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Pick a template - or build your own - preview exactly where it would
            have entered and exited on live market data, then add it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-white/5 px-3 py-1 font-mono text-xs text-muted">
            {tier.tradesPerDay} trades/day
          </span>
          <span className="rounded-md border border-gain/40 bg-gain/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-gain">
            all templates free
          </span>
        </div>
      </div>
      {strategies.length === 0 && (
        <section>
          <p className="mb-3 text-sm text-muted">
            First time picking a strategy? Answer five quick questions and
            we&rsquo;ll point you at a template that fits your temperament.
          </p>
          <StrategyQuiz />
        </section>
      )}
      <StrategyManager strategies={strategies} breakdown={breakdown} />

      {/* Recurring buy (DCA): simulator only until the engine can run it live. */}
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-fg">
              {DCA_META.label}
              <span className="ml-2 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                {DCA_META.kind}
              </span>
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {DCA_META.blurb}
            </p>
          </div>
          <span className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
            preview only
          </span>
        </div>
        <DcaPreview />
      </section>
    </div>
  );
}
