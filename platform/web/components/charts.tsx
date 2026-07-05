// Zero-dependency SVG charts. Server-renderable (no client JS). Palette matches
// tailwind.config.ts exactly. No gradients - solid low-opacity fills only.
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
        <div className="flex items-center gap-2 pt-1.5">
          <dt className="text-muted">Total</dt>
          <dd className="ml-auto font-mono tabular-nums text-dim">{total}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Underwater (drawdown) curve: 0% pinned to the top, depth grows downward in loss red.
 *  `points` are drawdown depths as POSITIVE percentages (0 = at the peak). */
export function DrawdownCurve({
  points,
  height = 180,
  xTicks = [],
}: {
  points: number[];
  height?: number;
  xTicks?: string[];
}) {
  if (points.length < 2) return <ChartEmpty height={height} label="Not enough history yet." />;
  const W = 1000;
  const H = 300;
  const N = 4;
  const maxDD = Math.max(...points, 0.1); // never a zero-height domain
  const hi = maxDD * 1.08; // headroom below the deepest trough
  const y = (v: number) => (v / hi) * H;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `M0 0 ${points.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} L${W} 0 Z`;
  const yTicks = Array.from({ length: N + 1 }, (_, i) => (i / N) * hi);
  // deepest point, direct-labeled
  let troughIdx = 0;
  for (let i = 1; i < points.length; i++) if (points[i] > points[troughIdx]) troughIdx = i;

  return (
    <ChartFrame height={height} yTicks={yTicks} xTicks={xTicks} fmtY={(v) => (v === 0 ? "0%" : `-${v.toFixed(1)}%`)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Drawdown from peak over time">
        {yTicks.map((_, i) => (
          <line key={i} x1={0} x2={W} y1={(i / N) * H} y2={(i / N) * H} stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} x2={W} y1={0} y2={0} stroke={C.faint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={area} fill={C.loss} fillOpacity={0.12} />
        <path d={path} fill="none" stroke={C.loss} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {points[troughIdx] > 0.05 && (
          <circle cx={x(troughIdx)} cy={y(points[troughIdx])} r={3.5} fill={C.loss} vectorEffect="non-scaling-stroke">
            <title>{`Max drawdown -${points[troughIdx].toFixed(1)}%`}</title>
          </circle>
        )}
      </svg>
    </ChartFrame>
  );
}

/** Distribution of daily P&L: how the days cluster around zero. Bars left of zero in
 *  loss red, right of zero in gain green - the shape tells you more than the average. */
export function PnlHistogram({
  values,
  height = 180,
  fmt = (n: number) => n.toFixed(0),
}: {
  values: number[];
  height?: number;
  fmt?: (n: number) => string;
}) {
  if (values.length < 3) return <ChartEmpty height={height} label="Not enough closed days yet." />;
  const W = 1000;
  const H = 300;
  const N = 4;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const span = hi - lo || 1;
  const bins = Math.min(13, Math.max(5, Math.ceil(Math.sqrt(values.length)) | 1)); // odd → a bin brackets 0
  const w = span / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  const maxC = Math.max(...counts, 1);
  const yTicks = Array.from({ length: N + 1 }, (_, i) => maxC - (i / N) * maxC);
  const slot = W / bins;
  const bw = slot * 0.82;
  const zeroX = ((0 - lo) / span) * W;
  const xTicks = [fmt(lo), "0", fmt(hi)];

  return (
    <ChartFrame height={height} yTicks={yTicks} xTicks={xTicks} fmtY={(v) => `${Math.round(v)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Distribution of daily profit and loss">
        {yTicks.map((_, i) => (
          <line key={i} x1={0} x2={W} y1={(i / N) * H} y2={(i / N) * H} stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {counts.map((c, i) => {
          if (c === 0) return null;
          const center = lo + (i + 0.5) * w;
          const h = (c / maxC) * (H - 6);
          return (
            <rect
              key={i}
              x={i * slot + (slot - bw) / 2}
              y={H - h}
              width={bw}
              height={h}
              fill={center < 0 ? C.loss : C.gain}
              fillOpacity={0.8}
              rx={1}
            >
              <title>{`${fmt(lo + i * w)} to ${fmt(lo + (i + 1) * w)}: ${c} day${c === 1 ? "" : "s"}`}</title>
            </rect>
          );
        })}
        <line x1={zeroX} x2={zeroX} y1={0} y2={H} stroke={C.faint} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
    </ChartFrame>
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
