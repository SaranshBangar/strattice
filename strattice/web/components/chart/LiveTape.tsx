"use client";
// Fixed-axis streaming chart engine. The axes, gridlines and tick labels hold
// still while the price line scrolls through the plot like a conveyor belt.
//
// How the motion works: path coordinates are anchored in absolute time
// (x = (t - epoch) · px/ms), so appending a point never moves the ones already
// drawn. The whole series sits in a <g> whose translateX steps one slot left
// per tick with `transition: transform <tickMs>ms linear` - the browser
// composites the glide on the GPU and JS only runs on the parent's append
// cadence. A clipPath on an OUTER (untransformed) group hides whatever has
// scrolled out. The y-domain comes from useStickyDomain, so the vertical scale
// re-snaps rarely and glides when it does.
import { useEffect, useRef, useState } from "react";
import { bandPath, linePath, sma, ema } from "@/lib/chart-math";
import { C, ChartFrame, LegendKey, PlotLabel, RefLine } from "./primitives";
import { useStickyDomain } from "./useStickyDomain";

export type LiveTapePoint = { t: number; v: number };

export type LiveTapeOverlay = {
  id: string;
  label: string;
  period: number;
  kind: "sma" | "ema";
  color: string;
  dash?: string;
};

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

export function LiveTape({
  points,
  windowMs,
  tickMs,
  height,
  fmtY,
  color,
  overlays = [],
  baseline = null,
  baselineLabel = "open",
  xLabels = "relative",
  legend = true,
  note,
  domainKey,
  ariaLabel,
}: {
  points: LiveTapePoint[]; // rolling, timestamped; parent appends on its cadence
  windowMs: number; // visible span
  tickMs: number; // parent's append cadence → drives the glide duration
  height: number;
  fmtY: (n: number) => string;
  color?: string; // price stroke; defaults to gain/loss by window direction
  overlays?: LiveTapeOverlay[];
  baseline?: number | null; // reference for the green/red split wash
  baselineLabel?: string;
  xLabels?: "relative" | "clock";
  legend?: boolean;
  note?: string;
  domainKey?: string | number; // refit the y-domain instantly when this changes
  ariaLabel: string;
}) {
  const W = 1000;
  const H = 300;
  const N = 4;
  const reduce = usePrefersReducedMotion();
  const clipId = useRef(`tape${Math.random().toString(36).slice(2, 8)}`).current;

  // Epoch = timestamp of the buffer's first point. When the parent prunes the
  // buffer the epoch shifts and every x coordinate + the transform change by
  // exactly offsetting amounts - visually nothing moves, but the CSS transition
  // must be disabled for that one commit or it would animate the "jump".
  const epochRef = useRef<number | null>(null);
  const prevFirstT = points.length ? points[0].t : null;
  const epochShifted =
    epochRef.current !== null && prevFirstT !== null && prevFirstT !== epochRef.current;
  if (prevFirstT !== null) epochRef.current = prevFirstT;

  const n = points.length;
  const values = points.map((p) => p.v);
  const tLast = n ? points[n - 1].t : 0;
  const epoch = epochRef.current ?? tLast;
  const pxPerMs = W / windowMs;
  const x = (i: number) => (points[i].t - epoch) * pxPerMs;
  const cutoff = tLast - windowMs;

  // Overlay series over the full buffer (so they're warm at the left edge).
  const overlaySeries = overlays.map((o) =>
    o.kind === "ema" ? ema(values, o.period) : sma(values, o.period),
  );

  // Domain extremes over the VISIBLE window, overlays included so a moving
  // average never clips against the top or bottom.
  let wLo = Infinity;
  let wHi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (points[i].t < cutoff) continue;
    const v = values[i];
    if (v < wLo) wLo = v;
    if (v > wHi) wHi = v;
    for (const s of overlaySeries) {
      const ov = s[i];
      if (ov != null) {
        if (ov < wLo) wLo = ov;
        if (ov > wHi) wHi = ov;
      }
    }
  }
  const { lo, hi, ticks } = useStickyDomain(wLo, wHi, {
    intervals: N,
    resetKey: domainKey,
  });
  const span = hi - lo || 1;
  const y = (v: number) => ((hi - v) / span) * H;

  if (n < 2) return <div style={{ height }} />;

  const pricePath = linePath(values, x, y);
  const bandD =
    baseline != null ? bandPath(values, values.map(() => baseline), x, y) : "";
  const baselineY = baseline != null ? y(baseline) : null;
  const baselineVisible =
    baselineY != null && baselineY > -H * 0.02 && baselineY < H * 1.02;

  // The conveyor: everything drawn at absolute-time x glides left so the last
  // point always lands at the right edge after one tick's transition.
  const tx = W - (tLast - epoch) * pxPerMs;
  const transition =
    reduce || epochShifted ? "none" : `transform ${tickMs}ms linear`;
  const moveStyle = {
    transform: `translateX(${tx.toFixed(2)}px)`,
    transition,
  } as const;

  const xTickLabels =
    xLabels === "relative"
      ? Array.from({ length: N + 1 }, (_, j) =>
          j === N ? "now" : `-${Math.round((windowMs * (N - j)) / N / 1000)}s`,
        )
      : Array.from({ length: N + 1 }, (_, j) =>
          new Date(tLast - ((N - j) * windowMs) / N).toLocaleTimeString(
            "en-IN",
            { hour: "2-digit", minute: "2-digit", second: "2-digit" },
          ),
        );

  const up = values[n - 1] >= (baseline ?? values[0]);
  const stroke = color ?? (up ? C.gain : C.loss);
  const legendNode =
    legend && (overlays.length > 0 || baseline != null) ? (
      <LegendKey
        items={[
          { label: "price", color: stroke, kind: "line" },
          ...overlays.map((o) => ({
            label: o.label,
            color: o.color,
            kind: (o.dash ? "dash" : "line") as "dash" | "line",
          })),
          ...(baseline != null
            ? [
                { label: "above open", color: C.gain, kind: "area" as const },
                { label: "below open", color: C.loss, kind: "area" as const },
              ]
            : []),
        ]}
      />
    ) : undefined;

  return (
    <ChartFrame
      height={height}
      yTicks={ticks}
      xTicks={xTickLabels}
      fmtY={fmtY}
      legend={legendNode}
      note={note}
      fadeTicks
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        style={{ height, display: "block" }}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <clipPath id={`${clipId}-plot`}>
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
          {baselineY != null && (
            <>
              <clipPath id={`${clipId}-above`}>
                <rect x={0} y={0} width={W} height={Math.max(0, Math.min(baselineY, H))} />
              </clipPath>
              <clipPath id={`${clipId}-below`}>
                <rect
                  x={0}
                  y={Math.max(0, Math.min(baselineY, H))}
                  width={W}
                  height={Math.max(0, H - Math.max(0, Math.min(baselineY, H)))}
                />
              </clipPath>
            </>
          )}
        </defs>

        {/* Fixed chrome: gridlines + axis frame never move, by construction. */}
        {Array.from({ length: N + 1 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            x2={W}
            y1={(i / N) * H}
            y2={(i / N) * H}
            stroke={C.line}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: N + 1 }, (_, j) => (
          <line
            key={`v${j}`}
            x1={(j / N) * W}
            x2={(j / N) * W}
            y1={0}
            y2={H}
            stroke={C.line}
            strokeWidth={1}
            strokeOpacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1={0} x2={0} y1={0} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W} y1={H} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* Green/red wash between price and the open: the same scrolling band
            painted twice through two FIXED clip rects split at the open line. */}
        {baselineY != null && bandD && (
          <>
            <g clipPath={`url(#${clipId}-above)`}>
              <g style={moveStyle}>
                <path d={bandD} fill={C.gain} fillOpacity={0.1} />
              </g>
            </g>
            <g clipPath={`url(#${clipId}-below)`}>
              <g style={moveStyle}>
                <path d={bandD} fill={C.loss} fillOpacity={0.1} />
              </g>
            </g>
          </>
        )}

        {/* The scrolling series */}
        <g clipPath={`url(#${clipId}-plot)`}>
          <g style={moveStyle}>
            {overlays.map((o, k) => (
              <path
                key={o.id}
                d={linePath(overlaySeries[k], x, y)}
                fill="none"
                stroke={o.color}
                strokeWidth={1.5}
                strokeDasharray={o.dash}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            <path
              d={pricePath}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* Open reference: horizontal, so it lives in fixed space. */}
        {baselineVisible && <RefLine y={baselineY!} W={W} />}
      </svg>

      {baselineVisible && (
        <PlotLabel yFrac={baselineY! / H} xFrac={0.99} color={C.faint}>
          {baselineLabel}
        </PlotLabel>
      )}

      {/* Pulsing head - HTML so animate-ping just works; the head is always at
          the right edge because the newest point glides to exactly x=W. */}
      <div
        className="pointer-events-none absolute"
        style={{
          right: -4,
          top: `${(y(values[n - 1]) / H) * 100}%`,
          transform: "translateY(-50%)",
          transition: reduce ? "none" : `top ${tickMs}ms linear`,
        }}
      >
        <span className="relative flex h-2 w-2">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-[1px] opacity-70"
            style={{ backgroundColor: stroke }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-[1px]"
            style={{ backgroundColor: stroke }}
          />
        </span>
      </div>
    </ChartFrame>
  );
}
