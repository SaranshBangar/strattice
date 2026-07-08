// Lightweight in-memory fixed-window limiter for public, unauthenticated routes that are
// NOT Better Auth endpoints (those use the DB-backed limiter in lib/auth.ts). State lives
// per-serverless-instance, so it caps a single hot instance rather than the whole fleet -
// enough to blunt a naive flood on a cache-fronted endpoint without paying a DB write per
// request. For anything security-sensitive, use the Better Auth limiter instead.
type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

/** True if the request is allowed; false once `max` is exceeded within `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  // Opportunistically prune expired buckets so the map can't grow without bound.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now >= b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
