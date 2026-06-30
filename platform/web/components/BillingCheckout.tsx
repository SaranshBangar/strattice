"use client";
import { useState, useTransition } from "react";
import { load } from "@cashfreepayments/cashfree-js";
import { startSubscriptionAction, cancelSubscriptionAction } from "@/app/actions";

interface TierOpt { name: string; priceInr: number; perk: string }

const inr = (n: number) => new Intl.NumberFormat("en-IN").format(n);

export function BillingCheckout({ tiers, currentTier, canCancel }: {
  tiers: TierOpt[]; currentTier: string; canCancel: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const phoneValid = /^\d{10}$/.test(phone);

  function subscribe(tier: string) {
    setErr(null);
    start(async () => {
      try {
        const { sessionId, mode } = await startSubscriptionAction(tier, phone);
        const cashfree = await load({ mode: mode as "sandbox" | "production" });
        // subscriptionsCheckout opens the mandate authorization flow, then redirects to return_url.
        await (cashfree as any).subscriptionsCheckout({ subsSessionId: sessionId, redirectTarget: "_self" });
      } catch (e: any) { setErr(e.message ?? "Failed"); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-5">
        <h2 className="font-display text-sm font-semibold tracking-tight text-dim">Set up payment</h2>
        <p className="mt-1 text-sm text-muted">Used for UPI Autopay / eMandate authorization.</p>
        <div className="mt-4 max-w-xs space-y-1.5">
          <label htmlFor="bc-phone" className="block text-sm font-medium text-dim">Phone</label>
          <input
            id="bc-phone"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit phone"
            aria-invalid={phone.length > 0 && !phoneValid}
            className="w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <p className="text-xs text-faint">Required to authorize the mandate. Numbers only.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => {
          const current = t.name === currentTier;
          return (
            <div
              key={t.name}
              className={[
                "flex flex-col rounded-lg border bg-panel p-5",
                current ? "border-accent ring-1 ring-accent/30" : "border-line",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-dim">{t.name}</h3>
                {current && (
                  <span className="rounded-sm bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-mono text-2xl font-semibold tracking-tight text-fg">₹{inr(t.priceInr)}</span>
                <span className="text-sm text-faint">/mo</span>
              </div>
              <p className="mt-3 flex-1 text-sm text-muted">{t.perk}</p>
              <button
                type="button"
                disabled={pending || current || !phoneValid}
                onClick={() => subscribe(t.name)}
                title={!phoneValid && !current ? "Enter a 10-digit phone number first" : undefined}
                className="mt-5 inline-flex items-center justify-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {current ? "Current plan" : pending ? "Starting…" : "Subscribe"}
              </button>
            </div>
          );
        })}
      </div>

      {err && <p role="alert" className="text-sm text-loss">{err}</p>}

      {canCancel && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm("Cancel your subscription? You keep access until the end of the current period.")) return;
            start(() => cancelSubscriptionAction());
          }}
          className="rounded-md border border-loss/40 px-4 py-2 text-sm text-dim transition-colors hover:bg-loss/10 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:opacity-50"
        >
          Cancel subscription (keep access until period end)
        </button>
      )}
    </div>
  );
}
