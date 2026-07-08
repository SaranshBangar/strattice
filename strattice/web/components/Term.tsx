import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/**
 * Glossary word with a CSS-only definition tooltip. Server-safe (no JS):
 * shows on hover and on keyboard focus via the tabbable trigger, styles in
 * globals.css (.tip-wrap / .tip / .term).
 *
 *   <Term k="drawdown">drawdown</Term>
 */
export function Term({
  k,
  children,
  flip = false,
}: {
  k: GlossaryKey;
  children: ReactNode;
  // Right-align the tooltip when the term sits near the viewport's right edge.
  flip?: boolean;
}) {
  return (
    <span className="tip-wrap">
      <span tabIndex={0} className="term focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {children}
      </span>
      <span role="tooltip" className={`tip${flip ? " tip-left" : ""}`}>
        {GLOSSARY[k]}
      </span>
    </span>
  );
}
