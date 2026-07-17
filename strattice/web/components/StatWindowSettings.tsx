"use client";
import { useState, useTransition } from "react";
import { setStatWindowAction } from "@/app/actions";
import {
  STAT_WINDOW_ORDER,
  STAT_WINDOWS,
  isStatWindow,
  DEFAULT_STAT_WINDOW,
} from "@/lib/stat-window";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";

const OPTIONS = STAT_WINDOW_ORDER.map((k) => ({
  value: k,
  label: STAT_WINDOWS[k].label,
}));

export function StatWindowSettings({ initial }: { initial: string }) {
  const toast = useToast();
  const [value, setValue] = useState<string>(
    isStatWindow(initial) ? initial : DEFAULT_STAT_WINDOW,
  );
  const [, start] = useTransition();

  function onChange(next: string) {
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await setStatWindowAction(next);
        toast(
          `Dashboard timeline set to ${STAT_WINDOWS[next as keyof typeof STAT_WINDOWS].label}`,
          "success",
        );
      } catch {
        setValue(prev);
        toast("Couldn't update the timeline. Please try again.", "error");
      }
    });
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-dim">
        Dashboard timeline
      </h2>
      <p className="mt-1 text-sm text-muted">
        How far back the stat-card trend sparklines (and the pro-view charts)
        look. The headline numbers are always up to date - this only changes the
        trends.
      </p>
      <div className="mt-4 max-w-xs">
        <Select
          value={value}
          onChange={onChange}
          options={OPTIONS}
          ariaLabel="Dashboard trend timeline"
        />
      </div>
    </section>
  );
}
