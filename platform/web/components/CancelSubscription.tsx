"use client";
// Shown only to users with a legacy paid subscription now that pricing is off,
// so nobody keeps getting charged for entitlements everyone has for free.
import { useTransition } from "react";
import { cancelSubscriptionAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

export function CancelSubscription() {
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            "Cancel your subscription? Everything stays unlocked - the platform is free.",
          )
        )
          return;
        start(async () => {
          try {
            await cancelSubscriptionAction();
            toast(
              "Subscription cancelled. Everything stays unlocked.",
              "success",
            );
          } catch (e: any) {
            toast(e.message ?? "Couldn't cancel. Please try again.", "error");
          }
        });
      }}
      className="inline-flex items-center gap-2 rounded-md border border-loss/40 px-4 py-2 text-sm text-dim transition-colors hover:bg-loss/10 hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:opacity-50"
    >
      {pending && <Spinner className="h-4 w-4" />}
      Cancel subscription
    </button>
  );
}
