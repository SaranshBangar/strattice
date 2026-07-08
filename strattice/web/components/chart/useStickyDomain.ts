"use client";
// Sticky quantized y-domain for streaming charts: the axis holds still while
// the line moves. The domain is a nice-number band with hysteresis - it only
// re-snaps when the data breaches a guard margin or stays tiny inside it for a
// sustained stretch, and re-snaps glide (lerp) instead of jumping. Gridline
// GEOMETRY never moves (always at even fractions of the plot); only the tick
// label values change, and only occasionally.
import { useRef } from "react";
import { niceDomain } from "@/lib/chart-math";

type Opts = {
  intervals?: number; // gridline intervals (ticks = intervals + 1)
  marginFrac?: number; // guard band inside the domain edges before a re-snap
  padFrac?: number; // padding around the data when (re)fitting
  shrinkFrac?: number; // re-fit when data occupies less than this for a while
  shrinkTicks?: number; // ... this many consecutive calls
  lerp?: number; // per-call approach rate toward a new target domain
  // Refit instantly (no glide) when this changes - e.g. the user switched to a
  // different market whose price scale is unrelated to the current one.
  resetKey?: string | number;
};

export function useStickyDomain(
  wLo: number,
  wHi: number,
  opts: Opts = {},
): { lo: number; hi: number; ticks: number[] } {
  const {
    intervals = 4,
    marginFrac = 0.04,
    padFrac = 0.25,
    shrinkFrac = 0.3,
    shrinkTicks = 20,
    lerp = 0.55,
    resetKey,
  } = opts;

  const st = useRef<{
    lo: number;
    hi: number;
    target: { lo: number; hi: number } | null;
    shrinkCount: number;
  } | null>(null);
  const keyRef = useRef(resetKey);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    st.current = null;
  }

  const finite = Number.isFinite(wLo) && Number.isFinite(wHi) && wHi >= wLo;

  const fit = () => {
    const pad = Math.max(
      (wHi - wLo) * padFrac,
      Math.abs(wHi) * 0.0004, // a near-flat window must not produce a hairline domain
      1e-9,
    );
    const d = niceDomain(wLo - pad, wHi + pad, intervals);
    return { lo: d.lo, hi: d.hi };
  };

  if (!finite) {
    const cur = st.current ?? { lo: 0, hi: 1, target: null, shrinkCount: 0 };
    return { lo: cur.lo, hi: cur.hi, ticks: ticksOf(cur.lo, cur.hi, intervals) };
  }

  if (!st.current) {
    const f = fit();
    st.current = { ...f, target: null, shrinkCount: 0 };
    return { ...f, ticks: ticksOf(f.lo, f.hi, intervals) };
  }

  const s = st.current;
  const span = s.hi - s.lo || 1;
  const breach =
    wHi > s.hi - marginFrac * span || wLo < s.lo + marginFrac * span;
  const occupancy = (wHi - wLo) / span;
  s.shrinkCount = occupancy < shrinkFrac ? s.shrinkCount + 1 : 0;

  if (breach || s.shrinkCount >= shrinkTicks) {
    s.target = fit();
    s.shrinkCount = 0;
  }

  if (s.target) {
    // Glide toward the new band instead of jumping; snap when close enough.
    s.lo += (s.target.lo - s.lo) * lerp;
    s.hi += (s.target.hi - s.hi) * lerp;
    const tSpan = s.target.hi - s.target.lo || 1;
    if (
      Math.abs(s.lo - s.target.lo) < tSpan * 0.004 &&
      Math.abs(s.hi - s.target.hi) < tSpan * 0.004
    ) {
      s.lo = s.target.lo;
      s.hi = s.target.hi;
      s.target = null;
    }
  }

  return { lo: s.lo, hi: s.hi, ticks: ticksOf(s.lo, s.hi, intervals) };
}

// Tick values from hi (top) down to lo (bottom) - the order ChartFrame expects.
function ticksOf(lo: number, hi: number, n: number) {
  return Array.from({ length: n + 1 }, (_, i) => hi - (i / n) * (hi - lo));
}
