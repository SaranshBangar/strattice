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
