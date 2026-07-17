// Shared by the dashboard server page and its client chart cards - plain
// functions (not component props) so they can be imported on either side of
// the server/client boundary without ever crossing it.

export function fmt(n: number) {
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
export function inr(n: number) {
  return `₹${fmt(n)}`;
}
export function shortDay(d: string) {
  return d?.slice(5) ?? d;
} // MM-DD
export function shortTs(ts: string) {
  return ts?.slice(0, 16).replace("T", " ") ?? "";
}

// Evenly pick k items (endpoints included) from an array - for axis tick labels.
export function sample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr;
  return Array.from(
    { length: k },
    (_, j) => arr[Math.round((j * (arr.length - 1)) / (k - 1))],
  );
}

// Snapshot ts is UTC "YYYY-MM-DD HH:MM:SS" (occasionally already zoned); pin it to UTC
// before parsing so window/axis math doesn't drift by the viewer's offset.
export function tsMs(ts: string): number {
  return Date.parse(
    ts.replace(" ", "T") + (/[Z+]/.test(ts.slice(10)) ? "" : "Z"),
  );
}

// Format a UTC epoch-ms back to the same "YYYY-MM-DD HH:MM" shape as shortTs, so
// interpolated axis ticks read identically to the point labels.
export function fmtTsMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

// Normalized 0..1 x positions for a time series, spaced by ACTUAL elapsed time rather
// than by array index. Poll snapshots land at irregular intervals, so index-based
// spacing makes an hour-long gap look identical to a one-minute gap; positioning by
// timestamp keeps the horizontal axis honest and its gaps consistent. Falls back to
// even index spacing when every point shares a timestamp (zero span).
export function xFractions(times: number[]): number[] {
  const n = times.length;
  if (n <= 1) return times.map(() => 0);
  const lo = times[0];
  const hi = times[n - 1];
  if (!(hi > lo)) return times.map((_, i) => i / (n - 1));
  return times.map((t) => (t - lo) / (hi - lo));
}

// k axis labels at EVEN time divisions across the series span (not even array
// positions), so the gap between adjacent labels is a constant slice of time. Paired
// with xFractions, points and ticks then share one time-proportional axis.
export function timeTicks(times: number[], k: number): string[] {
  if (times.length === 0) return [];
  const lo = times[0];
  const hi = times[times.length - 1];
  if (!(hi > lo)) return [fmtTsMs(lo)];
  return Array.from({ length: k }, (_, j) => fmtTsMs(lo + (j * (hi - lo)) / (k - 1)));
}
