"use client";
// Reopens the product tour by firing the event <Walkthrough/> listens for. Kept separate so
// server components (the Account page) can drop in a replay control without going client.
import { TOUR_EVENT } from "@/components/Walkthrough";

export function TourButton({ className, label = "Take the tour" }: { className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-dim transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      }
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 16h.01" />
      </svg>
      {label}
    </button>
  );
}
