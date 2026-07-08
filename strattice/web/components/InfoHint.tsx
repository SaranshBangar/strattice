/**
 * A small "?" beside a label that explains the metric in plain English on
 * hover/focus. Same CSS-only tooltip mechanism as <Term> - server-safe,
 * keyboard reachable.
 */
export function InfoHint({
  text,
  flip = false,
}: {
  text: string;
  // Right-align the tooltip when the hint sits near the viewport's right edge.
  flip?: boolean;
}) {
  return (
    <span className="tip-wrap align-middle">
      <span
        tabIndex={0}
        aria-label={text}
        className="grid h-4 w-4 cursor-help place-items-center rounded-full bg-white/5 font-mono text-[9px] leading-none text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ?
      </span>
      <span role="tooltip" className={`tip${flip ? " tip-left" : ""}`}>
        {text}
      </span>
    </span>
  );
}
