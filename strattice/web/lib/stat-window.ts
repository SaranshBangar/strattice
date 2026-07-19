// Dashboard stat-card timeline: the time window the three top stat cards' trend sparklines
// (and, since they share the same series, the pro-view charts/metrics) are computed over.
// Stored per user in notification_prefs.stat_window; default 1 day. The big headline numbers
// are latest/all-time and are NOT affected - only the trend windows.
//
// `hours` bounds the equity-snapshot time series (null => all time). `days` maps the same
// choice onto the daily-P&L series (which is bucketed per calendar day, so sub-day windows
// still show at least the current day).
// Windows follow the standard chart-timeline vocabulary (lib/timeframes.ts):
// 1H / 3H / 6H / 12H / 1D / 1W / 1M / ALL. Keys are stored per user, so the
// legacy keys ("6h", "1m", …) keep their meaning - the set only grows.
export const STAT_WINDOWS = {
  "1h": { label: "1H", hours: 1, days: 1 },
  "3h": { label: "3H", hours: 3, days: 1 },
  "6h": { label: "6H", hours: 6, days: 1 },
  "12h": { label: "12H", hours: 12, days: 1 },
  "1d": { label: "1D", hours: 24, days: 1 },
  "1w": { label: "1W", hours: 24 * 7, days: 7 },
  "1m": { label: "1M", hours: 24 * 30, days: 30 },
  all: { label: "All time", hours: null, days: 365 },
} as const;

export type StatWindow = keyof typeof STAT_WINDOWS;

export const DEFAULT_STAT_WINDOW: StatWindow = "1d";

export const STAT_WINDOW_ORDER: StatWindow[] = [
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "1w",
  "1m",
  "all",
];

export function isStatWindow(v: string): v is StatWindow {
  return Object.prototype.hasOwnProperty.call(STAT_WINDOWS, v);
}

export function statWindow(v: string | null | undefined) {
  const key = v && isStatWindow(v) ? v : DEFAULT_STAT_WINDOW;
  return { key, ...STAT_WINDOWS[key] };
}

/** UTC cutoff for a window, formatted to match equity_snapshots.ts ("YYYY-MM-DD HH:MM:SS").
 *  null for the "all time" window (no lower bound). */
export function windowSinceISO(
  hours: number | null,
  now = Date.now(),
): string | null {
  if (hours == null) return null;
  return new Date(now - hours * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
