import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { StrategyManager } from "@/components/StrategyManager";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [tier, strategies] = await Promise.all([
    q.effectiveTier(user.id), q.listStrategies(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Strategies</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Pick a template - or build your own - preview exactly where it would have entered and
            exited on live market data, then add it.
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
      <StrategyManager strategies={strategies} />
    </div>
  );
}
