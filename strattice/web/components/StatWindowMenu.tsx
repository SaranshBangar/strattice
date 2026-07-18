"use client";
// Compact dashboard timeline picker. Lives next to the stat cards it controls
// (moved here from Settings): click the button, pick a window from the dropdown,
// the trend sparklines re-render on the spot.
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

export function StatWindowMenu({ initial }: { initial: string }) {
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
    <Select
      size="sm"
      className="w-28"
      value={value}
      onChange={onChange}
      options={OPTIONS}
      ariaLabel="Dashboard trend timeline"
    />
  );
}
