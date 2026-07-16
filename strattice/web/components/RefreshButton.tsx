"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Round icon-only button beside the Pro-view toggle. router.refresh() re-runs the
// force-dynamic dashboard's server fetch in place (no full reload, scroll kept). The icon
// spins while the refresh is in flight.
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [spin, setSpin] = useState(false);

  function refresh() {
    setSpin(true);
    start(() => router.refresh());
    // Guarantee at least one visible turn even when the refetch is near-instant.
    window.setTimeout(() => setSpin(false), 600);
  }

  return (
    <button
      type="button"
      onClick={refresh}
      aria-label="Refresh data"
      title="Refresh data"
      className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        viewBox="0 0 24 24"
        className={[
          "h-4 w-4",
          spin || pending ? "animate-spin" : "",
        ].join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
