import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { CancelSubscription } from "@/components/CancelSubscription";

export const dynamic = "force-dynamic";

// Pricing is disabled for now - the whole platform is free. This route stays alive
// because old Cashfree return URLs point at it, and legacy subscribers still need a
// way to cancel their mandate.
export default async function BillingPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const sub = await q.getSubscription(user.id);
  const canCancel = !!sub?.cashfree_sub_id && (sub.status === "active" || sub.status === "pending");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Billing</h1>

      <section className="rounded-lg border border-line bg-panel p-6">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gain" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-gain">free during early access</span>
        </div>
        <h2 className="mt-3 font-display text-lg font-semibold tracking-tight text-fg">
          Everything is free right now.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          All strategy templates, unlimited active strategies, the full analytics dashboard and
          100 trades a day - no plan, no card, no mandate. If we ever introduce paid plans,
          you&rsquo;ll be told well in advance and nothing will be charged without your explicit consent.
        </p>
        <Link
          href="/strategies"
          className="mt-4 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Browse strategies
        </Link>
      </section>

      {canCancel && (
        <section className="rounded-lg border border-line bg-panel p-6">
          <h2 className="font-display text-sm font-semibold tracking-tight text-dim">Legacy subscription</h2>
          <p className="mt-2 text-sm text-muted">
            You still have a <span className="font-medium capitalize text-fg">{sub!.tier}</span> subscription
            ({sub!.status})
            {sub!.period_end ? ` · renews ${new Date(sub!.period_end * 1000).toLocaleDateString()}` : ""}.
            Since the platform is now free, we recommend cancelling it - you lose nothing.
          </p>
          <div className="mt-4">
            <CancelSubscription />
          </div>
        </section>
      )}

      <p className="text-xs text-faint">
        Your trading capital always stays in your own CoinDCX account - Strattice never holds funds.
      </p>
    </div>
  );
}
