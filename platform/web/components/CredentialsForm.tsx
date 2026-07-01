"use client";
import { useRef, useTransition } from "react";
import { saveCredentialsAction } from "@/app/actions";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

export function CredentialsForm({ linked }: { linked: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        await saveCredentialsAction(fd);
        toast(linked ? "API keys replaced" : "CoinDCX account linked", "success");
        formRef.current?.reset();
      } catch (err: any) {
        toast(err?.message ?? "Couldn't save keys. Please try again.", "error");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="mt-4 max-w-md space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="ak-label" className={labelClass}>Label</label>
        <input id="ak-label" name="label" placeholder="My CoinDCX key" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ak-key" className={labelClass}>API key</label>
        <input id="ak-key" name="apiKey" required autoComplete="off" className={`${inputClass} font-mono`} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ak-secret" className={labelClass}>API secret</label>
        <input id="ak-secret" name="secret" required type="password" autoComplete="off" placeholder="••••••••••••••••" className={`${inputClass} font-mono`} />
        <p className="text-xs text-muted">Stored encrypted. We never display your secret back to you.</p>
      </div>
      <button
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending && <Spinner className="h-4 w-4" />}
        {pending ? "Saving…" : linked ? "Replace keys" : "Link account"}
      </button>
    </form>
  );
}
