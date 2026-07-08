import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import { StrategyBuilder } from "@/components/StrategyBuilder";

export const dynamic = "force-dynamic";

export default async function BuildStrategyPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/strategies"
          className="font-mono text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline"
        >
          ← Strategies
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          Build your own strategy
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Stack entry conditions - all must be true on the same bar to buy - and
          set the exits. Every change re-simulates instantly on live market data
          and across four history windows, and your strategy runs on the same
          risk-managed engine as the stock templates.
        </p>
      </div>
      <StrategyBuilder />
    </div>
  );
}
