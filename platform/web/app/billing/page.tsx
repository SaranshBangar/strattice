import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import * as q from "@/lib/queries";
import { TIERS, PAID_TIERS } from "@/lib/entitlements";
import { BillingCheckout } from "@/components/BillingCheckout";

export const dynamic = "force-dynamic";

const PERK: Record<string, string> = {
  starter: "1 default strategy, 50 trades/day",
  plus: "Any 3 strategies + dashboard, 50 trades/day",
  pro: "All strategies + dashboard, 75 trades/day",
  max: "All + custom strategies + dashboard, 100 trades/day",
};

export default async function BillingPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");

  const [tier, sub] = await Promise.all([q.effectiveTier(user.id), q.getSubscription(user.id)]);
  const tiers = PAID_TIERS.map((name) => ({ name, priceInr: TIERS[name].priceInr, perk: PERK[name] }));
  const canCancel = !!sub?.cashfree_sub_id && (sub.status === "active" || sub.status === "pending");

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="text-sm text-muted">
        Current plan: <span className="font-medium capitalize text-fg">{tier.name}</span>
        {sub?.status && sub.status !== "active" ? ` (subscription: ${sub.status})` : ""}
        {sub?.period_end ? ` · renews/ends ${new Date(sub.period_end * 1000).toLocaleDateString()}` : ""}
      </p>
      <BillingCheckout tiers={tiers} currentTier={tier.name} canCancel={canCancel} />
      <p className="text-xs text-faint">
        Recurring billing via Cashfree (UPI Autopay / eMandate). Your trading capital stays in your
        own CoinDCX account — this only charges the subscription fee.
      </p>
    </div>
  );
}
