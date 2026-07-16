"use client";
import { useId, useRef, useState } from "react";
import { InfoHint } from "@/components/InfoHint";
import { C } from "@/components/chart/primitives";
import { inr } from "@/lib/dashboard-format";

// A stat card whose whole bottom edge is a full-bleed sparkline: gradient fill (the tone's
// colour at the line, fading to transparent at the card's bottom) and a hover tooltip that
// reads out the exact value + timestamp at the point under the cursor. Self-contained so the
// server dashboard can drop three of them in without passing any functions across the
// server/client boundary (values arrive pre-formatted; the tooltip formats with inr()).
type Tone = "default" | "good" | "bad";
const valueTone: Record<Tone, string> = {
  default: "text-fg",
  good: "text-gain",
  bad: "text-loss",
};
const strokeFor: Record<Tone, string> = {
  default: C.accent,
  good: C.gain,
  bad: C.loss,
};

export function GraphStatCard({
  label,
  value,
  sub,
  hint,
  tone = "default",
  data,
  labels,
  height = 56,
  fmt = inr,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  tone?: Tone;
  /** Raw series for the sparkline (oldest -> newest). */
  data: number[];
  /** One label per point (e.g. timestamp) shown in the hover tooltip. */
  labels?: string[];
  height?: number;
  /** Formats a point's value in the tooltip. Defaults to INR; the demo passes its
   *  currency-localized formatter (safe here - both caller and card are client-side). */
  fmt?: (n: number) => string;
}) {
  const gid = "gsc" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState<number | null>(null);

  const enough = data.length >= 2;
  const stroke = strokeFor[tone];

  let line = "";
  let leftPct = 0;
  let dotTop = 0;
  const W = 120;
  const H = height;
  if (enough) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const x = (i: number) => (i / (data.length - 1)) * W;
    const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
    line = data
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");
    if (hi != null) {
      leftPct = (hi / (data.length - 1)) * 100;
      dotTop = y(data[hi]);
    }
  }

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!enough) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHi(Math.round(f * (data.length - 1)));
  }

  // Keep the tooltip pill from spilling past the card edges.
  const tipLeft = Math.min(86, Math.max(14, leftPct));

  return (
    <div className="flex flex-col card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
      <div
        className={[
          "mt-2 font-mono text-2xl font-semibold tnum tracking-tight",
          valueTone[tone],
        ].join(" ")}
      >
        {value}
      </div>
      {sub && <div className="mt-1 font-mono text-xs text-muted">{sub}</div>}

      {enough && (
        <div
          ref={wrapRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHi(null)}
          className="relative -mx-4 -mb-4 mt-auto pt-3"
          role="img"
          aria-label={`${label} trend`}
        >
          <div className="overflow-hidden rounded-b-xl" style={{ height: H }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height={H}
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ display: "block" }}
            >
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${gid})`} />
              <path
                d={line}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          {hi != null && (
            <>
              <div
                className="pointer-events-none absolute bottom-0 top-3 w-px bg-white/15"
                style={{ left: `${leftPct}%` }}
              />
              <div
                className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
                style={{
                  left: `${leftPct}%`,
                  top: `calc(0.75rem + ${dotTop}px)`,
                  background: stroke,
                }}
              />
              <div
                className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-inset px-2 py-1 shadow-lg"
                style={{ left: `${tipLeft}%` }}
              >
                <div
                  className="font-mono text-xs font-semibold tnum"
                  style={{ color: stroke }}
                >
                  {fmt(data[hi])}
                </div>
                {labels?.[hi] && (
                  <div className="mt-0.5 font-mono text-[10px] text-faint">
                    {labels[hi]}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
