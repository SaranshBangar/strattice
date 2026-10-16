"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCredentialsAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";
import { EXCHANGES, EXCHANGE_META, type Exchange } from "@/lib/exchanges";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

// Per-exchange key setup, shown for whichever venue is selected.
const STEPS: Record<Exchange, readonly (readonly [string, string])[]> = {
  coindcx: [
    [
      "Create an API key on CoinDCX",
      "Account → API dashboard → create a new key.",
    ],
    [
      "Enable trading, disable withdrawals",
      "The bot needs the first and must never have the second.",
    ],
    [
      "Add our server IP to the key's allowlist",
      "So the key only works from the machine that runs your bots.",
    ],
  ],
  binance: [
    [
      "Create an API key on Binance",
      "Profile → API Management → Create API → System generated.",
    ],
    [
      "Enable Spot & Margin Trading only",
      "Leave withdrawals and futures off - the bot trades spot, long-only.",
    ],
    [
      "Restrict access to our server IP",
      "Binance can disable trading on unrestricted keys, and an IP lock means a leaked key is useless elsewhere.",
    ],
  ],
};

export function CredentialsForm({
  linked,
  exchange: linkedExchange,
}: {
  linked: boolean;
  exchange: Exchange;
}) {
  const [pending, start] = useTransition();
  // Already-linked users land on a "Replace keys?" button, not the raw form -
  // a fat-fingered submit shouldn't be one click away from overwriting a working key.
  const [showForm, setShowForm] = useState(!linked);
  const [exchange, setExchange] = useState<Exchange>(linkedExchange);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const meta = EXCHANGE_META[exchange];
  const switching = linked && exchange !== linkedExchange;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("exchange", exchange);
    start(async () => {
      try {
        await saveCredentialsAction(fd);
        toast(
          switching
            ? `Switched to ${meta.label} - the bot is back in DRY_RUN`
            : linked
              ? "API keys replaced"
              : `${meta.label} account linked`,
          "success",
        );
        formRef.current?.reset();
        setShowForm(false);
        router.refresh();
      } catch (err: any) {
        toast(err?.message ?? "Couldn't save keys. Please try again.", "error");
      }
    });
  }

  if (linked && !showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="mt-4 rounded-md bg-white/5 px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Replace keys or switch exchange
      </button>
    );
  }

  return (
    <div className="mt-4 max-w-md space-y-4">
      <fieldset>
        <legend className={labelClass}>Exchange</legend>
        <div
          role="radiogroup"
          aria-label="Exchange"
          className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg border border-line bg-inset p-1"
        >
          {EXCHANGES.map((ex) => {
            const on = ex === exchange;
            return (
              <button
                key={ex}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setExchange(ex)}
                className={`rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  on
                    ? "bg-accent/15 text-fg ring-1 ring-accent/50"
                    : "text-muted hover:bg-white/5 hover:text-fg"
                }`}
              >
                <span className="block text-sm font-medium">
                  {EXCHANGE_META[ex].label}
                </span>
                <span className="block font-mono text-[10px] text-faint">
                  {EXCHANGE_META[ex].quote} pairs · ~
                  {EXCHANGE_META[ex].frictionPct}% round trip
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted">{meta.costNote}</p>
        {switching && (
          <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            Switching moves your bot to {meta.label}: your strategies are
            re-pointed at {meta.quote} pairs and live trading turns off until
            you confirm it again. Close any open positions on{" "}
            {EXCHANGE_META[linkedExchange].label} first.
          </p>
        )}
      </fieldset>

      <ol className="space-y-2.5">
        {STEPS[exchange].map(([title, hint], i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-white/5 font-mono text-[10px] text-faint">
              {i + 1}
            </span>
            <div>
              <div className="text-sm text-fg">{title}</div>
              <div className="text-xs text-muted">{hint}</div>
            </div>
          </li>
        ))}
      </ol>

      <form ref={formRef} onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="ak-label" className={labelClass}>
            Label
          </label>
          <input
            id="ak-label"
            name="label"
            placeholder={`My ${meta.label} key`}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ak-key" className={labelClass}>
            API key
          </label>
          <input
            id="ak-key"
            name="apiKey"
            required
            autoComplete="off"
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ak-secret" className={labelClass}>
            API secret
          </label>
          <input
            id="ak-secret"
            name="secret"
            required
            type="password"
            autoComplete="off"
            placeholder="••••••••••••••••"
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-muted">
            Stored encrypted. We never display your secret back to you.{" "}
            <a
              href={meta.keysUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Open {meta.label} API settings ↗
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending && <Spinner className="h-4 w-4" />}
            {pending
              ? "Saving…"
              : switching
                ? `Switch to ${meta.label}`
                : linked
                  ? "Replace keys"
                  : `Link ${meta.label}`}
          </button>
          {linked && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowForm(false);
                setExchange(linkedExchange);
              }}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
