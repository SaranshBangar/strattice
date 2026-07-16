"use client";
import { useState } from "react";

// Animated FAQ accordion. One panel open at a time; the answer expands with a CSS-only
// grid-rows 0fr -> 1fr transition (smooth height, no JS measuring), the marker rotates, and
// the open card lifts on a faint wash rather than a hard border. Motion is dropped under
// prefers-reduced-motion. Replaces the native <details> so open/close is actually animated.
export function FaqList({
  items,
}: {
  items: readonly (readonly [string, string])[];
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-2">
      {items.map(([question, answer], i) => {
        const isOpen = open === i;
        return (
          <div
            key={question}
            className={[
              "card overflow-hidden transition-colors duration-300",
              isOpen ? "bg-white/[0.045]" : "hover:bg-white/[0.02]",
            ].join(" ")}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-fg transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
            >
              {question}
              <span
                aria-hidden="true"
                className={[
                  "shrink-0 font-mono transition-transform duration-300 ease-out motion-reduce:transition-none",
                  isOpen ? "rotate-90 text-accent" : "text-faint",
                ].join(" ")}
              >
                ▸
              </span>
            </button>
            <div
              className={[
                "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              ].join(" ")}
            >
              <div className="overflow-hidden">
                <p className="max-w-xl px-5 pb-4 text-sm leading-relaxed text-muted">
                  {answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
