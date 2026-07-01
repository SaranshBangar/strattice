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

function Frame({ children, corners }: { children: ReactNode; corners?: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {corners}
    </div>
  );
}

/** Filled line chart for a value that trends over time (e.g. account equity). */
export function EquityCurve({
  points,
  height = 200,
  fmt = (n: number) => n.toFixed(2),
  labels,
}: {
  points: number[];
  height?: number;
  fmt?: (n: number) => string;
  labels?: [string, string]; // [firstLabel, lastLabel] shown under the plot
}) {
  if (points.length < 2) return <ChartEmpty height={height} label="Not enough history yet." />;
  const W = 1000;
  const H = 300;
  const padY = 10;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${W} ${H} L0 ${H} Z`;
  const up = points[points.length - 1] >= points[0];
  const stroke = up ? C.gain : C.loss;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);
  const midV = (min + max) / 2;

  return (
    <Frame
      corners={
        <>
          <span className="pointer-events-none absolute right-2 top-1 font-mono text-[10px] text-faint">{fmt(max)}</span>
          <span className="pointer-events-none absolute bottom-6 right-2 font-mono text-[10px] text-faint">{fmt(min)}</span>
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Equity over time">
        {[min, midV, max].map((v, gi) => (
          <line key={gi} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={stroke} fillOpacity={0.08} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r={3.5} fill={stroke} vectorEffect="non-scaling-stroke" />
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </Frame>
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
  const padY = 8;
  const vals = data.map((d) => d.value);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const zeroY = padY + (max / span) * (H - padY * 2);
  const n = data.length;
  const slot = W / n;
  const bw = Math.min(slot * 0.62, 46);
  const y = (v: number) => padY + ((max - v) / span) * (H - padY * 2);

  return (
    <Frame
      corners={
        <>
          <span className="pointer-events-none absolute right-2 top-1 font-mono text-[10px] text-faint">{fmt(max)}</span>
          {min < 0 && <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[10px] text-faint">{fmt(min)}</span>}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height, display: "block" }} role="img" aria-label="Daily profit and loss">
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
    </Frame>
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
