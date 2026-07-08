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
  const canCancel =
    !!sub?.cashfree_sub_id &&
    (sub.status === "active" || sub.status === "pending");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Billing
      </h1>

      <section className="overflow-hidden card">
        <div className="flex items-center justify-between px-5 py-2.5">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-gain">
            <span className="h-1.5 w-1.5 rounded-[1px] bg-gain" />
            free during early access
          </span>
          <span className="font-mono text-[11px] text-muted">₹0 / mo</span>
        </div>
        <div className="p-5">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">
            Everything is free right now.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            All strategy templates, unlimited active strategies, the full
            analytics dashboard and 100 trades a day - no plan, no card, no
            mandate. If we ever introduce paid plans, you&rsquo;ll be told well
            in advance and nothing will be charged without your explicit
            consent.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["templates", "all 7"],
                ["strategies", "no cap"],
                ["trades / day", "100"],
                ["analytics", "full + pro"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-md bg-inset px-3 py-2.5">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-faint">
                  {k}
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-fg">{v}</dd>
              </div>
            ))}
          </dl>
          <Link
            href="/strategies"
            className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Browse strategies
          </Link>
        </div>
      </section>

      {canCancel && (
        <section className="card p-6">
          <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
            Legacy subscription
          </h2>
          <p className="mt-2 text-sm text-muted">
            You still have a{" "}
            <span className="font-medium capitalize text-fg">{sub!.tier}</span>{" "}
            subscription ({sub!.status})
            {sub!.period_end
              ? ` · renews ${new Date(sub!.period_end * 1000).toLocaleDateString()}`
              : ""}
            . Since the platform is now free, we recommend cancelling it - you
            lose nothing.
          </p>
          <div className="mt-4">
            <CancelSubscription />
          </div>
        </section>
      )}

      <p className="text-xs text-faint">
        Your trading capital always stays in your own CoinDCX account -
        Strattice never holds funds.
      </p>
    </div>
  );
}
