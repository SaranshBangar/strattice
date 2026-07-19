// Zero-dependency SVG charts. Server-renderable (no client JS). Palette matches
// tailwind.config.ts exactly. Area fills are solid low-opacity, or an optional
// colour -> transparent vertical gradient on sparklines (opt-in per chart).
// Shared axis chrome, reference lines and highlight primitives live in
// ./chart/primitives; pure series math (SMA, high-water-mark, paths) in
// lib/chart-math.
import {
  C,
  ChartEmpty,
  ChartFrame,
  GridLines,
  LegendKey,
  PlotLabel,
  RefLine,
  ticksDown,
} from "./chart/primitives";
import { bandPath, highWaterMark } from "@/lib/chart-math";

export { ChartEmpty, ChartFrame, ticksDown };

/** Filled line chart for a value that trends over time (e.g. account equity).
 *  Optional finery: a dashed high-water-mark step line (`hwm`), red shading of
 *  the gap between peak and equity (`ddShade`), a labelled starting-value
 *  reference (`baseline`), a legend, and a one-time draw-in animation. */
export function EquityCurve({
  points,
  height = 200,
  fmt = (n: number) => n.toFixed(2),
  xTicks = [],
  hwm = false,
  ddShade = false,
  baseline,
  legend = false,
  drawIn = false,
  emptySub,
  emptyAction,
  pointLabels,
  xs,
}: {
  points: number[];
  height?: number;
  fmt?: (n: number) => string;
  xTicks?: string[]; // time labels sampled left → right under the plot
  hwm?: boolean;
  ddShade?: boolean;
  baseline?: { value: number; label: string };
  legend?: boolean;
  drawIn?: boolean;
  emptySub?: string;
  emptyAction?: { href: string; label: string };
  pointLabels?: string[]; // one label per point, for hover tooltips (unlike the sampled xTicks)
  xs?: number[]; // per-point 0..1 x positions (time-proportional); omit for even index spacing
}) {
  if (points.length < 2)
    return (
      <ChartEmpty
        height={height}
        label="Not enough history yet."
        sub={emptySub}
        action={emptyAction}
      />
    );
  const W = 1000;
  const H = 300;
  const N = 4; // gridline / tick count
  const hwmSeries = hwm || ddShade ? highWaterMark(points) : null;
  let min = Math.min(...points);
  let max = Math.max(...points);
  if (baseline) {
    min = Math.min(min, baseline.value);
    max = Math.max(max, baseline.value);
  }
  // Pad the domain ~6% so the line doesn't graze the top/bottom edges; axis ticks
  // are computed over the padded domain so labels align with the gridlines.
  const pad = (max - min) * 0.06 || Math.abs(max) * 0.06 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo;
  // x positions come from real timestamps when supplied (consistent time gaps), else
  // fall back to even index spacing.
  const x = (i: number) =>
    (xs ? xs[i] : i / (points.length - 1)) * W;
  const y = (v: number) => ((hi - v) / span) * H;
  const path = points
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join(" ");
  const area = `${path} L${W} ${H} L0 ${H} Z`;
  const up = points[points.length - 1] >= points[0];
  const stroke = up ? C.gain : C.loss;
  const yTicks = ticksDown(lo, hi, N);
  // Peak line drawn as steps: it only ever moves up, and holds flat in between.
  let hwmPath = "";
  if (hwmSeries) {
    hwmPath = `M${x(0).toFixed(1)} ${y(hwmSeries[0]).toFixed(1)}`;
    for (let i = 1; i < hwmSeries.length; i++) {
      hwmPath += ` L${x(i).toFixed(1)} ${y(hwmSeries[i - 1]).toFixed(1)} L${x(i).toFixed(1)} ${y(hwmSeries[i]).toFixed(1)}`;
    }
  }
  const legendNode = legend ? (
    <LegendKey
      items={[
        { label: "equity", color: stroke, kind: "line" },
        ...(hwm
          ? [{ label: "peak", color: C.accent, kind: "dash" as const }]
          : []),
        ...(ddShade
          ? [{ label: "drawdown", color: C.loss, kind: "area" as const }]
          : []),
        ...(baseline
          ? [{ label: baseline.label, color: C.faint, kind: "dash" as const }]
          : []),
      ]}
    />
  ) : undefined;

  return (
    <ChartFrame
      height={height}
      yTicks={yTicks}
      xTicks={xTicks}
      fmtY={fmt}
      legend={legendNode}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: "block" }}
        role="img"
        aria-label="Equity over time"
      >
        <GridLines n={N} W={W} H={H} />
        {/* Vertical guidelines matching the evenly spaced time labels below */}
        {Array.from({ length: Math.max(2, xTicks.length || N + 1) }, (_, j) => (
          <line
            key={`vx${j}`}
            x1={(j / (Math.max(2, xTicks.length || N + 1) - 1)) * W}
            x2={(j / (Math.max(2, xTicks.length || N + 1) - 1)) * W}
            y1={0}
            y2={H}
            stroke={C.line}
            strokeWidth={1}
            strokeOpacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Axis frame: y-axis left, x-axis bottom */}
        <line x1={0} x2={0} y1={0} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={H} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {baseline && <RefLine y={y(baseline.value)} W={W} />}
        <path
          d={area}
          fill={stroke}
          fillOpacity={0.08}
          className={drawIn ? "chart-fade" : undefined}
        />
        {ddShade && hwmSeries && (
          <path
            d={bandPath(hwmSeries, points, x, y)}
            fill={C.loss}
            fillOpacity={0.08}
            className={drawIn ? "chart-fade" : undefined}
          />
        )}
        {hwm && hwmSeries && (
          <path
            d={hwmPath}
            fill="none"
            stroke={C.accent}
            strokeWidth={1.25}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            className={drawIn ? "chart-fade" : undefined}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={drawIn ? 1 : undefined}
          className={drawIn ? "chart-draw" : undefined}
        />
        <circle
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1])}
          r={3.5}
          fill={stroke}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={9}
            fill="transparent"
            className="cursor-default"
          >
            <title>{`${pointLabels?.[i] ?? `#${i + 1}`}: ${fmt(v)}`}</title>
          </circle>
        ))}
      </svg>
      {baseline && (
        <PlotLabel yFrac={y(baseline.value) / H} xFrac={0.99} color={C.faint}>
          {baseline.label}
        </PlotLabel>
      )}
    </ChartFrame>
  );
}

// Bar with the data end rounded and the baseline end square - a rect's rx would
// wrongly round both.
function barPath(
  x0: number,
  w: number,
  top: number,
  bottom: number,
  roundTop: boolean,
) {
  const r = Math.min(4, w / 2, Math.abs(bottom - top));
  if (roundTop) {
    return [
      `M${(x0).toFixed(1)} ${bottom.toFixed(1)}`,
      `L${x0.toFixed(1)} ${(top + r).toFixed(1)}`,
      `Q${x0.toFixed(1)} ${top.toFixed(1)} ${(x0 + r).toFixed(1)} ${top.toFixed(1)}`,
      `L${(x0 + w - r).toFixed(1)} ${top.toFixed(1)}`,
      `Q${(x0 + w).toFixed(1)} ${top.toFixed(1)} ${(x0 + w).toFixed(1)} ${(top + r).toFixed(1)}`,
      `L${(x0 + w).toFixed(1)} ${bottom.toFixed(1)} Z`,
    ].join(" ");
  }
  return [
    `M${x0.toFixed(1)} ${top.toFixed(1)}`,
    `L${(x0 + w).toFixed(1)} ${top.toFixed(1)}`,
    `L${(x0 + w).toFixed(1)} ${(bottom - r).toFixed(1)}`,
    `Q${(x0 + w).toFixed(1)} ${bottom.toFixed(1)} ${(x0 + w - r).toFixed(1)} ${bottom.toFixed(1)}`,
    `L${(x0 + r).toFixed(1)} ${bottom.toFixed(1)}`,
    `Q${x0.toFixed(1)} ${bottom.toFixed(1)} ${x0.toFixed(1)} ${(bottom - r).toFixed(1)} Z`,
  ].join(" ");
}

/** Diverging bars around a zero baseline (e.g. daily realized P&L). */
export function PnlBars({
  data,
  height = 200,
  fmt = (n: number) => n.toFixed(0),
  annotateExtremes = false,
  emptySub,
  emptyAction,
}: {
  data: { label: string; value: number }[];
  height?: number;
  fmt?: (n: number) => string;
  annotateExtremes?: boolean;
  emptySub?: string;
  emptyAction?: { href: string; label: string };
}) {
  if (data.length === 0)
    return (
      <ChartEmpty
        height={height}
        label="No closed trades yet."
        sub={emptySub}
        action={emptyAction}
      />
    );
  const W = 1000;
  const H = 300;
  const N = 4; // gridline / tick count
  const vals = data.map((d) => d.value);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const n = data.length;
  const slot = W / n;
  const bw = Math.max(1, Math.min(slot * 0.62, 46, slot - 2));
  const y = (v: number) => ((max - v) / span) * H;
  const zeroY = y(0);
  const yTicks = ticksDown(min, max, N);
  // X labels: up to 6 evenly-sampled day labels, endpoints included.
  const k = Math.min(6, n);
  const xTicks =
    k <= 1
      ? [data[0].label]
      : Array.from(
          { length: k },
          (_, j) => data[Math.round((j * (n - 1)) / (k - 1))].label,
        );
  // Direct-label only the best and the worst day - the two bars a newcomer
  // actually asks about. Values wear text ink, not the bar color.
  let bestIdx = 0;
  let worstIdx = 0;
  for (let i = 1; i < n; i++) {
    if (vals[i] > vals[bestIdx]) bestIdx = i;
    if (vals[i] < vals[worstIdx]) worstIdx = i;
  }
  const extremes =
    annotateExtremes && n > 1
      ? [
          ...(vals[bestIdx] > 0 ? [bestIdx] : []),
          ...(vals[worstIdx] < 0 && worstIdx !== bestIdx ? [worstIdx] : []),
        ]
      : [];

  return (
    <ChartFrame height={height} yTicks={yTicks} xTicks={xTicks} fmtY={fmt}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: "block" }}
        role="img"
        aria-label="Daily profit and loss"
      >
        {yTicks.map((v, i) => {
          const gy = (i / N) * H;
          // Zero baseline drawn brighter than the other gridlines.
          return (
            <line
              key={i}
              x1={0}
              x2={W}
              y1={gy}
              y2={gy}
              stroke={Math.abs(v) < 1e-9 ? C.faint : C.line}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <line
          x1={0}
          x2={W}
          y1={zeroY}
          y2={zeroY}
          stroke={C.faint}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => {
          const cx = i * slot + slot / 2;
          const pos = d.value >= 0;
          const top = pos ? y(d.value) : zeroY;
          const bottom = pos ? zeroY : y(d.value);
          const h = Math.max(1, bottom - top);
          return (
            <path
              key={i}
              d={barPath(cx - bw / 2, bw, top, top + h, pos)}
              fill={pos ? C.gain : C.loss}
              fillOpacity={0.85}
              className="chart-bar"
            >
              <title>{`${d.label}: ${fmt(d.value)}`}</title>
            </path>
          );
        })}
      </svg>
      {extremes.map((i) => {
        const v = vals[i];
        const cx = (i * slot + slot / 2) / W;
        const edgeY = y(v) / H;
        const yFrac = Math.min(
          0.94,
          Math.max(0.05, v >= 0 ? edgeY - 0.07 : edgeY + 0.07),
        );
        return (
          <PlotLabel key={i} xFrac={cx} yFrac={yFrac} align="center" color="#AEB6C8">
            {fmt(v)}
          </PlotLabel>
        );
      })}
    </ChartFrame>
  );
}

/** Donut for a two-part ratio (wins vs losses). Pure stroke arcs, no gradient. */
export function WinRateDonut({
  wins,
  losses,
  size = 132,
}: {
  wins: number;
  losses: number;
  size?: number;
}) {
  const total = wins + losses;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const winFrac = total ? wins / total : 0;
  const pct = Math.round(winFrac * 100);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 132 132" width={size} height={size}>
          {/* Base ring is neutral until there is at least one closed trade - a red
              ring at zero trades reads as "losing" before anything has happened. */}
          <circle
            cx={66}
            cy={66}
            r={r}
            fill="none"
            stroke={total ? C.loss : C.line}
            strokeOpacity={total ? 0.5 : 1}
            strokeWidth={14}
          />
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
            <div className="font-mono text-xl font-semibold tabular-nums text-fg">
              {total ? `${pct}%` : "-"}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
              win rate
            </div>
          </div>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: C.gain }}
          />
          <dt className="text-muted">Wins</dt>
          <dd className="ml-auto font-mono tabular-nums text-dim">{wins}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: C.loss }}
          />
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
  guide = false,
  pointLabels,
  xs,
}: {
  points: number[];
  height?: number;
  xTicks?: string[];
  guide?: boolean; // dashed reference at the deepest drawdown, labelled
  pointLabels?: string[]; // one label per point, for hover tooltips
  xs?: number[]; // per-point 0..1 x positions (time-proportional); omit for even index spacing
}) {
  if (points.length < 2)
    return <ChartEmpty height={height} label="Not enough history yet." />;
  const W = 1000;
  const H = 300;
  const N = 4;
  const maxDD = Math.max(...points, 0.1); // never a zero-height domain
  const hi = maxDD * 1.08; // headroom below the deepest trough
  const y = (v: number) => (v / hi) * H;
  const x = (i: number) => (xs ? xs[i] : i / (points.length - 1)) * W;
  const path = points
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join(" ");
  const area = `M0 0 ${points.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} L${W} 0 Z`;
  const yTicks = Array.from({ length: N + 1 }, (_, i) => (i / N) * hi);
  // deepest point, direct-labeled
  let troughIdx = 0;
  for (let i = 1; i < points.length; i++)
    if (points[i] > points[troughIdx]) troughIdx = i;
  const showGuide = guide && points[troughIdx] > 0.05;

  return (
    <ChartFrame
      height={height}
      yTicks={yTicks}
      xTicks={xTicks}
      fmtY={(v) => (v === 0 ? "0%" : `-${v.toFixed(1)}%`)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: "block" }}
        role="img"
        aria-label="Drawdown from peak over time"
      >
        <GridLines n={N} W={W} H={H} />
        <line
          x1={0}
          x2={W}
          y1={0}
          y2={0}
          stroke={C.faint}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {showGuide && (
          <RefLine y={y(points[troughIdx])} W={W} color={C.loss} opacity={0.5} />
        )}
        <path d={area} fill={C.loss} fillOpacity={0.12} />
        <path
          d={path}
          fill="none"
          stroke={C.loss}
          strokeWidth={1.75}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points[troughIdx] > 0.05 && (
          <circle
            cx={x(troughIdx)}
            cy={y(points[troughIdx])}
            r={3.5}
            fill={C.loss}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`Max drawdown -${points[troughIdx].toFixed(1)}%`}</title>
          </circle>
        )}
        {points.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={9}
            fill="transparent"
            className="cursor-default"
          >
            <title>{`${pointLabels?.[i] ?? `#${i + 1}`}: -${v.toFixed(1)}%`}</title>
          </circle>
        ))}
      </svg>
      {showGuide && (
        <PlotLabel
          yFrac={Math.min(0.93, y(points[troughIdx]) / H + 0.05)}
          xFrac={0.99}
          color={C.loss}
        >
          max -{points[troughIdx].toFixed(1)}%
        </PlotLabel>
      )}
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
  if (values.length < 3)
    return <ChartEmpty height={height} label="Not enough closed days yet." />;
  const W = 1000;
  const H = 300;
  const N = 4;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const span = hi - lo || 1;
  const bins = Math.min(
    13,
    Math.max(5, Math.ceil(Math.sqrt(values.length)) | 1),
  ); // odd → a bin brackets 0
  const w = span / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values)
    counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  const maxC = Math.max(...counts, 1);
  const yTicks = Array.from({ length: N + 1 }, (_, i) => maxC - (i / N) * maxC);
  const slot = W / bins;
  const bw = slot * 0.82;
  const zeroX = ((0 - lo) / span) * W;
  const xTicks = [fmt(lo), "0", fmt(hi)];

  return (
    <ChartFrame
      height={height}
      yTicks={yTicks}
      xTicks={xTicks}
      fmtY={(v) => `${Math.round(v)}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: "block" }}
        role="img"
        aria-label="Distribution of daily profit and loss"
      >
        <GridLines n={N} W={W} H={H} />
        {counts.map((c, i) => {
          if (c === 0) return null;
          const center = lo + (i + 0.5) * w;
          const h = (c / maxC) * (H - 6);
          return (
            <path
              key={i}
              d={barPath(i * slot + (slot - bw) / 2, bw, H - h, H, true)}
              fill={center < 0 ? C.loss : C.gain}
              fillOpacity={0.8}
              className="chart-bar"
            >
              <title>{`${fmt(lo + i * w)} to ${fmt(lo + (i + 1) * w)}: ${c} day${c === 1 ? "" : "s"}`}</title>
            </path>
          );
        })}
        <line
          x1={zeroX}
          x2={zeroX}
          y1={0}
          y2={H}
          stroke={C.faint}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </ChartFrame>
  );
}

/** Tiny inline trend line for stat cards. */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color,
  area = false,
  gradient = false,
  gradientId,
  fullWidth = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  area?: boolean;
  /** Fill under the line with a vertical color -> transparent gradient (top to bottom). */
  gradient?: boolean;
  /** Stable, unique id for the gradient def. Required when `gradient` so two sparklines
   *  on the same page never share a DOM id (server-safe - no useId in this RSC-friendly file). */
  gradientId?: string;
  /** Stretch to 100% of the container width instead of a fixed pixel width. */
  fullWidth?: boolean;
}) {
  if (data.length < 2) return <div style={{ height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const path = data
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join(" ");
  const stroke = color ?? (data[data.length - 1] >= data[0] ? C.gain : C.loss);
  const gid = gradientId ?? "spark-fill";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={fullWidth ? "100%" : width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={fullWidth ? { display: "block" } : undefined}
    >
      {gradient && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {(area || gradient) && (
        <path
          d={`${path} L${width} ${height} L0 ${height} Z`}
          fill={gradient ? `url(#${gid})` : stroke}
          fillOpacity={gradient ? 1 : 0.08}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
