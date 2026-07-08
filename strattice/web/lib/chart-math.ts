// Pure chart math shared by the server-rendered SVG charts, the live client
// tapes and the landing demos. No DOM, no React - safe on both sides.

/** Simple moving average. Entries before the first full window are null. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first window. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const NICE = [1, 2, 2.5, 5, 10];

/** Smallest "nice" step ({1,2,2.5,5,10}·10^k) so `intervals` steps cover rawSpan. */
export function niceStep(rawSpan: number, intervals: number): number {
  const raw = rawSpan / Math.max(1, intervals);
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of NICE) if (m * mag >= raw * (1 - 1e-9)) return m * mag;
  return 10 * mag;
}

function nextNiceStep(step: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const m = step / mag;
  for (const c of NICE) if (c > m * (1 + 1e-9)) return c * mag;
  return 10 * mag;
}

/**
 * Snap a raw [lo, hi] outward onto nice-step boundaries so every tick label is
 * a clean number. Always returns exactly `intervals` equal intervals with lo/hi
 * on step multiples (the step is bumped up until the domain covers the data).
 */
export function niceDomain(
  lo: number,
  hi: number,
  intervals = 4,
): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!(hi > lo)) {
    const p = Math.abs(lo) * 0.001 || 1;
    lo -= p;
    hi += p;
  }
  let step = niceStep(hi - lo, intervals);
  for (let guard = 0; guard < 12; guard++) {
    const nLo = Math.floor(lo / step + 1e-9) * step;
    const nHi = nLo + step * intervals;
    if (nHi >= hi - step * 1e-9) {
      const ticks = Array.from({ length: intervals + 1 }, (_, i) => nLo + i * step);
      return { lo: nLo, hi: nHi, step, ticks };
    }
    step = nextNiceStep(step);
  }
  // Unreachable in practice; fall back to the raw domain.
  const step2 = (hi - lo) / intervals;
  return {
    lo,
    hi,
    step: step2,
    ticks: Array.from({ length: intervals + 1 }, (_, i) => lo + i * step2),
  };
}

/** Polyline path. Null entries (e.g. an MA warming up) break and restart the line. */
export function linePath(
  pts: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i];
    if (v == null || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  }
  return d.trimEnd();
}

/** Closed area between a curve and a horizontal floor. */
export function areaPath(
  pts: number[],
  x: (i: number) => number,
  y: (v: number) => number,
  floorY: number,
): string {
  if (pts.length < 2) return "";
  const line = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  return `${line} L${x(pts.length - 1).toFixed(1)} ${floorY.toFixed(1)} L${x(0).toFixed(1)} ${floorY.toFixed(1)} Z`;
}

/** Closed region between two curves of equal length (e.g. peak vs equity). */
export function bandPath(
  upper: number[],
  lower: number[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const n = Math.min(upper.length, lower.length);
  if (n < 2) return "";
  let d = "";
  for (let i = 0; i < n; i++)
    d += `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(upper[i]).toFixed(1)} `;
  for (let i = n - 1; i >= 0; i--)
    d += `L${x(i).toFixed(1)} ${y(lower[i]).toFixed(1)} `;
  return d.trimEnd() + " Z";
}

/** Running maximum - the "best level so far" line over an equity series. */
export function highWaterMark(points: number[]): number[] {
  const out = new Array<number>(points.length);
  let peak = -Infinity;
  for (let i = 0; i < points.length; i++) {
    peak = Math.max(peak, points[i]);
    out[i] = peak;
  }
  return out;
}
