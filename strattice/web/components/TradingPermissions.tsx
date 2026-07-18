"use client";
// Explicit trading permissions. Shorting is a SEPARATE consent from everything else:
// off by default, gated server-side (the add-strategy path refuses short-capable
// templates while this is off), and honest about what it does - the live spot engine
// executes the long side only, so shorts run as research/paper behavior.
import { useState, useTransition } from "react";
import { setAllowShortingAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/NotificationSettings";

export function TradingPermissions({ initial }: { initial: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      try {
        await setAllowShortingAction(next);
        toast(
          next
            ? "Short-capable strategies unlocked"
            : "Short-capable strategies locked",
          "success",
        );
      } catch {
        setOn(!next);
        toast("Couldn't update the permission. Please try again.", "error");
      }
    });
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
        Trading permissions
      </h2>
      <p className="mt-1 text-sm text-muted">
        Extra capabilities that stay locked until you explicitly allow them.
      </p>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">
            Allow short-capable strategies
          </div>
          <div className="text-sm text-muted">
            Unlocks the experimental long/short templates in the strategy
            picker. They require a stop-loss <em>and</em> take-profit on every
            add, and our own backtests found no edge in the short side on this
            venue&apos;s history - read the warning before enabling one.
          </div>
        </div>
        <Toggle
          checked={on}
          disabled={pending}
          onClick={toggle}
          label="Allow short-capable strategies"
        />
      </div>

      <p className="mt-3 rounded-md bg-inset px-3 py-2 text-xs leading-relaxed text-muted">
        Spot markets cannot short: the live engine executes only the long side
        of these strategies, and their short signals run as paper/research
        behavior. Turning this off never removes strategies you already added -
        it only blocks new short-capable adds.
      </p>
    </section>
  );
}
