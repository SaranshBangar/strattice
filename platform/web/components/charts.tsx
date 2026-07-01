// Zero-dependency SVG charts. Server-renderable (no client JS). Palette matches
// tailwind.config.ts exactly. No gradients — solid low-opacity fills only.
import type { ReactNode } from "react";

const C = {
  gain: "#16B97D",
  loss: "#F0584F",
  accent: "#C9A24B",
  line: "#232838",
  faint: "#5A6379",
  muted: "#828AA0",
} as const;

function ChartEmpty({ height, label }: { height: number; label: string }) {
  return (
    <div
      className="grid place-items-center rounded-md border border-dashed border-line text-xs text-faint"
      style={{ height }}
    >
      {label}
    </div>
  );
}

/**
 * Axis chrome around a stretched (preserveAspectRatio="none") SVG plot: a left
 * Y-gutter with tick values aligned to the plot's gridlines, and a bottom X-gutter
 * with tick labels. The plot's own gridlines must sit at the same even fractions
 * (i / (yTicks.length - 1)) so labels line up. Y ticks run top → bottom.
 */
export function ChartFrame({
  height,
  yTicks,
  xTicks,
  fmtY,
  children,
}: {
  height: number;
  yTicks: number[];
  xTicks: string[];
  fmtY: (n: number) => string;
  children: ReactNode;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "3.75rem 1fr" }}>
      {/* Y axis */}
      <div className="relative" style={{ height }}>
        {yTicks.map((v, i) => (
          <span
            key={i}
            className="absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] leading-none tabular-nums text-faint"
            style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
          >
            {fmtY(v)}
          </span>
        ))}
      </div>
      {/* Plot */}
      <div style={{ height }}>{children}</div>
      {/* Corner + X axis */}
      <div />
      <div className="flex justify-between gap-1 overflow-hidden pt-1.5 font-mono text-[10px] tabular-nums text-faint">
        {xTicks.map((t, i) => (
          <span key={i} className="shrink-0 whitespace-nowrap">{t}</span>
        ))}
      </div>
    </div>
  );
}

// Evenly spaced tick values from hi (top) down to lo (bottom), inclusive.
function ticksDown(lo: number, hi: number, n = 4) {
  return Array.from({ length: n + 1 }, (_, i) => hi - (i / n) * (hi - lo));
}

/** Filled line chart for a value that trends over time (e.g. account equity). */
export function EquityCurve({
  points,
  height = 200,
  fmt = (n: number) => n.toFixed(2),
  xTicks = [],
}: {
  points: number[];
  height?: number;
  fmt?: (n: number) => string;
  xTicks?: string[]; // time labels sampled left → right under the plot
}) {
  if (points.length < 2) return <ChartEmpty height={height} label="Not enough history yet." />;
  const W = 1000;
  const H = 300;
  const N = 4; // gridline / tick count
  const min = Math.min(...points);
  const max = Math.max(...points);
  // Pad the domain ~6% so the line doesn't graze the top/bottom edges; axis ticks
  // are computed over the padded domain so labels align with the gridlines.
  const pad = (max - min) * 0.06 || Math.abs(max) * 0.06 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => ((hi - v) / span) * H;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${W} ${H} L0 ${H} Z`;
  const up = points[points.length - 1] >= points[0];
  const stroke = up ? C.gain : C.loss;
  const yTicks = ticksDown(lo, hi, N);

  return (
    <ChartFrame height={height} yTicks={yTicks} xTicks={xTicks} fmtY={fmt}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Equity over time">
        {yTicks.map((_, i) => {
          const gy = (i / N) * H;
          return <line key={i} x1={0} x2={W} y1={gy} y2={gy} stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        })}
        <path d={area} fill={stroke} fillOpacity={0.08} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={3.5} fill={stroke} vectorEffect="non-scaling-stroke" />
      </svg>
    </ChartFrame>
  );
}

/** Diverging bars around a zero baseline (e.g. daily realized P&L). */
export function PnlBars({
  data,
  height = 200,
  fmt = (n: number) => n.toFixed(0),
}: {
  data: { label: string; value: number }[];
  height?: number;
  fmt?: (n: number) => string;
}) {
  if (data.length === 0) return <ChartEmpty height={height} label="No closed trades yet." />;
  const W = 1000;
  const H = 300;
  const N = 4; // gridline / tick count
  const vals = data.map((d) => d.value);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const n = data.length;
  const slot = W / n;
  const bw = Math.min(slot * 0.62, 46);
  const y = (v: number) => ((max - v) / span) * H;
  const zeroY = y(0);
  const yTicks = ticksDown(min, max, N);
  // X labels: up to 6 evenly-sampled day labels, endpoints included.
  const k = Math.min(6, n);
  const xTicks =
    k <= 1 ? [data[0].label] : Array.from({ length: k }, (_, j) => data[Math.round((j * (n - 1)) / (k - 1))].label);

  return (
    <ChartFrame height={height} yTicks={yTicks} xTicks={xTicks} fmtY={fmt}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Daily profit and loss">
        {yTicks.map((v, i) => {
          const gy = (i / N) * H;
          // Zero baseline drawn brighter than the other gridlines.
          return <line key={i} x1={0} x2={W} y1={gy} y2={gy} stroke={Math.abs(v) < 1e-9 ? C.faint : C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        })}
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke={C.faint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const cx = i * slot + slot / 2;
          const top = d.value >= 0 ? y(d.value) : zeroY;
          const h = Math.max(1, Math.abs(zeroY - y(d.value)));
          return (
            <rect key={i} x={cx - bw / 2} y={top} width={bw} height={h} fill={d.value >= 0 ? C.gain : C.loss} fillOpacity={0.85} rx={1}>
              <title>{`${d.label}: ${fmt(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/** Donut for a two-part ratio (wins vs losses). Pure stroke arcs, no gradient. */
export function WinRateDonut({ wins, losses, size = 132 }: { wins: number; losses: number; size?: number }) {
  const total = wins + losses;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const winFrac = total ? wins / total : 0;
  const pct = Math.round(winFrac * 100);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 132 132" width={size} height={size}>
          <circle cx={66} cy={66} r={r} fill="none" stroke={C.loss} strokeOpacity={total ? 0.5 : 0.25} strokeWidth={14} />
          {total > 0 && (
            <circle
              cx={66}
              cy={66}
              r={r}
              fill="none"
              stroke={C.gain}
              strokeWidth={14}
              strokeDasharray={`${(circ * winFrac).toFixed(2)} ${circ.toFixed(2)}`}
              transform="rotate(-90 66 66)"
              strokeLinecap="butt"
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-xl font-semibold tabular-nums text-fg">{total ? `${pct}%` : "-"}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">win rate</div>
          </div>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.gain }} />
          <dt className="text-muted">Wins</dt>
          <dd className="ml-auto font-mono tabular-nums text-dim">{wins}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.loss }} />
          <dt className="text-muted">Losses</dt>
          <dd className="ml-auto font-mono tabular-nums text-dim">{losses}</dd>
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-1.5">
          <dt className="text-muted">Total</dt>
          <dd className="ml-auto font-mono tabular-nums text-dim">{total}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Tiny inline trend line for stat cards. */
export function Sparkline({ data, width = 120, height = 32, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <div style={{ height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const stroke = color ?? (data[data.length - 1] >= data[0] ? C.gain : C.loss);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
