// Server-safe chart building blocks shared by the static SVG charts
// (components/charts.tsx), the live tapes and the landing strategy demo.
// Two kinds of pieces live here:
//   - SVG-space parts (GridLines, RefLine, bands, SplitArea) drawn in viewBox
//     user units inside a preserveAspectRatio="none" plot;
//   - HTML-space parts (PlotLabel, Marker, LegendKey) positioned over the plot,
//     because text and icon shapes would distort inside a stretched SVG.
import type { ReactNode } from "react";
import Link from "next/link";

// Palette mirrors tailwind.config.ts exactly. Solid low-opacity fills only.
export const C = {
  gain: "#16B97D",
  loss: "#F0584F",
  accent: "#C9A24B",
  accentHi: "#DCB868",
  line: "#232838",
  axis: "#39415A",
  faint: "#5A6379",
  muted: "#828AA0",
} as const;

// Evenly spaced tick values from hi (top) down to lo (bottom), inclusive.
export function ticksDown(lo: number, hi: number, n = 4) {
  return Array.from({ length: n + 1 }, (_, i) => hi - (i / n) * (hi - lo));
}

export function ChartEmpty({
  height,
  label,
  sub,
  action,
}: {
  height: number;
  label: string;
  sub?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="grid place-items-center rounded-md border border-dashed border-line px-4"
      style={{ height }}
    >
      <div className="text-center">
        <div className="text-xs text-faint">{label}</div>
        {sub && (
          <div className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted">
            {sub}
          </div>
        )}
        {action && (
          <Link
            href={action.href}
            className="mt-3 inline-block rounded-md bg-white/5 px-2.5 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {action.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Axis chrome around a stretched (preserveAspectRatio="none") SVG plot: a left
 * Y-gutter with tick values aligned to the plot's gridlines, and a bottom X-gutter
 * with tick labels. The plot's own gridlines must sit at the same even fractions
 * (i / (yTicks.length - 1)) so labels line up. Y ticks run top → bottom.
 * The plot cell is position:relative so HTML overlays (PlotLabel, Marker,
 * tooltips) can be placed as siblings of the SVG.
 */
export function ChartFrame({
  height,
  yTicks,
  xTicks,
  fmtY,
  legend,
  note,
  fadeTicks = false,
  children,
}: {
  height: number;
  yTicks: number[];
  xTicks: string[];
  fmtY: (n: number) => string;
  legend?: ReactNode;
  note?: string;
  // Key tick labels by value so a re-snapped label remounts and fades in
  // (live tapes) instead of switching abruptly.
  fadeTicks?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {legend && <div className="mb-2.5 flex justify-end">{legend}</div>}
      <div className="grid" style={{ gridTemplateColumns: "3.75rem 1fr" }}>
        {/* Y axis */}
        <div className="relative" style={{ height }}>
          {yTicks.map((v, i) => (
            <span
              key={fadeTicks ? `${i}-${fmtY(v)}` : i}
              className={`absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] leading-none tabular-nums text-faint${fadeTicks ? " tick-in" : ""}`}
              style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
            >
              {fmtY(v)}
            </span>
          ))}
        </div>
        {/* Plot */}
        <div className="relative" style={{ height }}>
          {children}
        </div>
        {/* Corner + X axis */}
        <div />
        <div className="flex justify-between gap-1 overflow-hidden pt-1.5 font-mono text-[10px] tabular-nums text-faint">
          {xTicks.map((t, i) => (
            <span key={i} className="shrink-0 whitespace-nowrap">
              {t}
            </span>
          ))}
        </div>
      </div>
      {note && (
        <p
          className="mt-2 text-[11px] leading-relaxed text-faint"
          style={{ paddingLeft: "3.75rem" }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** Horizontal gridlines at even fractions of the plot height. */
export function GridLines({ n = 4, W, H }: { n?: number; W: number; H: number }) {
  return (
    <>
      {Array.from({ length: n + 1 }, (_, i) => (
        <line
          key={i}
          x1={0}
          x2={W}
          y1={(i / n) * H}
          y2={(i / n) * H}
          stroke={C.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

/** Dashed horizontal reference line (open price, start equity, max drawdown…).
 *  Label it with a PlotLabel sibling - text inside the stretched SVG distorts. */
export function RefLine({
  y,
  W,
  color = C.faint,
  dash = "5 4",
  opacity = 0.9,
}: {
  y: number;
  W: number;
  color?: string;
  dash?: string;
  opacity?: number;
}) {
  return (
    <line
      x1={0}
      x2={W}
      y1={y}
      y2={y}
      stroke={color}
      strokeWidth={1}
      strokeDasharray={dash}
      strokeOpacity={opacity}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** Horizontal shaded zone between two y values (e.g. above/below an entry). */
export function YBand({
  y1,
  y2,
  W,
  color,
  opacity = 0.06,
}: {
  y1: number;
  y2: number;
  W: number;
  color: string;
  opacity?: number;
}) {
  const top = Math.min(y1, y2);
  return (
    <rect x={0} y={top} width={W} height={Math.abs(y2 - y1)} fill={color} fillOpacity={opacity} />
  );
}

/** Vertical shaded region between two x values (a holding period, a session). */
export function XBand({
  x1,
  x2,
  H,
  color,
  opacity = 0.07,
}: {
  x1: number;
  x2: number;
  H: number;
  color: string;
  opacity?: number;
}) {
  const left = Math.min(x1, x2);
  return (
    <rect x={left} y={0} width={Math.abs(x2 - x1)} height={H} fill={color} fillOpacity={opacity} />
  );
}

/**
 * Gain/loss split highlight: one closed band path (curve ↔ baseline, built with
 * bandPath) painted twice through two clip rects - green where the curve sits
 * above the baseline, red where it dips below. No gradients.
 */
export function SplitArea({
  d,
  baselineY,
  W,
  H,
  id,
  opacity = 0.1,
}: {
  d: string;
  baselineY: number;
  W: number;
  H: number;
  id: string;
  opacity?: number;
}) {
  const yTop = Math.max(0, Math.min(baselineY, H));
  return (
    <g>
      <defs>
        <clipPath id={`${id}-above`}>
          <rect x={0} y={0} width={W} height={yTop} />
        </clipPath>
        <clipPath id={`${id}-below`}>
          <rect x={0} y={yTop} width={W} height={Math.max(0, H - yTop)} />
        </clipPath>
      </defs>
      <path d={d} fill={C.gain} fillOpacity={opacity} clipPath={`url(#${id}-above)`} />
      <path d={d} fill={C.loss} fillOpacity={opacity} clipPath={`url(#${id}-below)`} />
    </g>
  );
}

/** Small HTML label pinned over the plot (reference-line captions, extreme-bar
 *  values). Fractions are 0..1 of the plot box. Text stays in text tokens. */
export function PlotLabel({
  xFrac = 1,
  yFrac,
  align = "right",
  color,
  children,
}: {
  xFrac?: number;
  yFrac: number;
  align?: "left" | "right" | "center";
  color?: string;
  children: ReactNode;
}) {
  const pos =
    align === "right"
      ? { right: `${(1 - xFrac) * 100}%` }
      : align === "center"
        ? { left: `${xFrac * 100}%`, transform: "translate(-50%, -50%)" }
        : { left: `${xFrac * 100}%` };
  return (
    <span
      className="pointer-events-none absolute whitespace-nowrap font-mono text-[10px] leading-none tabular-nums"
      style={{
        top: `${yFrac * 100}%`,
        ...(align === "center" ? {} : { transform: "translateY(-50%)" }),
        color: color ?? "#828AA0",
        ...pos,
      }}
    >
      {children}
    </span>
  );
}

/** Entry ▲ / exit ▼ / dot marker as an HTML-embedded mini-SVG (undistorted),
 *  with a 1.5px page-color ring so it separates from the line underneath. */
export function Marker({
  xFrac,
  yFrac,
  kind,
  color,
}: {
  xFrac: number;
  yFrac: number;
  kind: "entry" | "exit" | "dot";
  color: string;
}) {
  return (
    <span
      className="pointer-events-none absolute"
      style={{
        left: `${xFrac * 100}%`,
        top: `${yFrac * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
    >
      <svg width={11} height={11} viewBox="0 0 12 12">
        {kind === "dot" ? (
          <circle cx={6} cy={6} r={4} fill={color} stroke="#0B0D12" strokeWidth={1.5} />
        ) : kind === "entry" ? (
          <path d="M6 1 11 10.5 1 10.5 Z" fill={color} stroke="#0B0D12" strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <path d="M6 11 1 1.5 11 1.5 Z" fill={color} stroke="#0B0D12" strokeWidth={1.5} strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}

/** Inline legend row: colored swatches carry identity, labels wear text tokens. */
export function LegendKey({
  items,
}: {
  items: { label: string; color: string; kind: "line" | "dash" | "area" }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.kind === "line" ? (
            <span
              className="h-[2px] w-3.5 rounded-full"
              style={{ background: it.color }}
              aria-hidden="true"
            />
          ) : it.kind === "dash" ? (
            <span
              className="h-[2px] w-3.5"
              style={{
                background: `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`,
              }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: it.color, opacity: 0.4 }}
              aria-hidden="true"
            />
          )}
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {it.label}
          </span>
        </span>
      ))}
    </div>
  );
}
