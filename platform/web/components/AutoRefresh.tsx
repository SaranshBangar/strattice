"use client";
// Periodically re-runs the server component tree (router.refresh) so the dashboard
// reflects fresh D1 state without a full reload. Toggleable; shows time since update.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [ago, setAgo] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setAgo((a) => a + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { router.refresh(); setAgo(0); }, intervalMs);
    return () => clearInterval(t);
  }, [on, intervalMs, router]);

  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      aria-pressed={on}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      title={on ? "Auto-refresh on — click to pause" : "Auto-refresh paused — click to resume"}
    >
      <span className={["h-1.5 w-1.5 rounded-full", on ? "animate-pulse bg-gain" : "bg-faint"].join(" ")} />
      {on ? `LIVE · ${ago}s` : "PAUSED"}
    </button>
  );
}
