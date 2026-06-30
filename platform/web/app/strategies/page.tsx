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
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Strategies</h1>
        <span className="rounded-md border border-line bg-panel px-3 py-1 font-mono text-xs uppercase tracking-wider text-dim">
          {tier.name} plan
        </span>
      </div>
      <p className="text-sm text-muted">
        {tier.tradesPerDay} trades/day · {tier.maxActive === null ? "unlimited" : tier.maxActive} active strategies ·{" "}
        {tier.custom ? "custom strategies allowed" : "stock strategies only"}
      </p>
      <StrategyManager allowed={[...tier.allowed]} maxActive={tier.maxActive} strategies={strategies} />
    </div>
  );
}
