"use client";
import { useState, useTransition } from "react";
import { setCurrencyAction } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";

const OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.flag} ${c.code} — ${c.name}`,
}));

export function CurrencySettings({ initial }: { initial: string }) {
  const toast = useToast();
  const [currency, setCurrency] = useState(initial);
  const [, start] = useTransition();

  function onChange(next: string) {
    const prev = currency;
    setCurrency(next);
    start(async () => {
      try {
        await setCurrencyAction(next);
        toast(`Currency set to ${next}`, "success");
      } catch {
        setCurrency(prev);
        toast("Couldn't update currency. Please try again.", "error");
      }
    });
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
        Currency
      </h2>
      <p className="mt-1 text-sm text-muted">
        Preferred currency for amounts shown across the app.
      </p>
      <div className="mt-4 max-w-xs">
        <Select
          value={currency}
          onChange={onChange}
          options={OPTIONS}
          ariaLabel="Display currency"
        />
      </div>
    </section>
  );
}
