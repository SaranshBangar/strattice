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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Strategies</h1>
        <span className="rounded-md border border-gain/40 bg-gain/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-gain">
          all templates free
        </span>
      </div>
      <p className="text-sm text-muted">
        Pick a template - or build your own - preview exactly where it would have entered and
        exited on live market data, then add it. Every template is unlocked · {tier.tradesPerDay} trades/day.
      </p>
      <StrategyManager strategies={strategies} />
    </div>
  );
}
