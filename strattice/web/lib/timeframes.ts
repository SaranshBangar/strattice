// Shared chart-timeline vocabulary. Every graph that offers a time window
// (drawdown, P&L distribution, price chart, dashboard trends) speaks the same
// industry-standard set - 1H, 3H, 6H, 12H, 1D, 1W, 1M, ALL - instead of each
// chart inventing its own ranges. Windows narrower than the loaded data are
// sliced client-side from what is already there (e.g. 1H and 3H both come out
// of the same few hours of snapshots).
export interface Timeframe {
  key: string;
  label: string;
  /** Window length; null = everything loaded. */
  ms: number | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TIMEFRAMES: Timeframe[] = [
  { key: "1h", label: "1H", ms: HOUR },
  { key: "3h", label: "3H", ms: 3 * HOUR },
  { key: "6h", label: "6H", ms: 6 * HOUR },
  { key: "12h", label: "12H", ms: 12 * HOUR },
  { key: "1d", label: "1D", ms: DAY },
  { key: "1w", label: "1W", ms: 7 * DAY },
  { key: "1mo", label: "1M", ms: 30 * DAY },
  { key: "all", label: "ALL", ms: null },
];

export function timeframe(key: string): Timeframe {
  return TIMEFRAMES.find((t) => t.key === key) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
}

/** The subset of standard windows the loaded data can actually fill (a series
 *  spanning 5 hours offers 1H and 3H, not 1W), always ending in ALL. */
export function timeframesFor(spanMs: number): Timeframe[] {
  const fit = TIMEFRAMES.filter((t) => t.ms !== null && t.ms <= spanMs);
  return [...fit, TIMEFRAMES[TIMEFRAMES.length - 1]];
}

/** Slice `items` to the chosen window by each item's timestamp (ms), keeping at
 *  least `min` points so a too-narrow window degrades to a short slice instead
 *  of an empty chart. */
export function sliceByTime<T>(
  items: T[],
  timeOf: (item: T) => number,
  tf: Timeframe,
  min = 2,
): T[] {
  if (tf.ms === null || items.length === 0) return items;
  const end = timeOf(items[items.length - 1]);
  const from = end - tf.ms;
  const sliced = items.filter((it) => timeOf(it) >= from);
  return sliced.length >= min ? sliced : items.slice(-min);
}
