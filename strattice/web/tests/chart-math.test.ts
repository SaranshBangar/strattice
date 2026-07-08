import { describe, expect, it } from "vitest";
import {
  sma,
  ema,
  niceStep,
  niceDomain,
  linePath,
  areaPath,
  bandPath,
  highWaterMark,
} from "@/lib/chart-math";

describe("sma", () => {
  it("nulls before the first full window, exact averages after", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("period 1 echoes the series", () => {
    expect(sma([7, 8, 9], 1)).toEqual([7, 8, 9]);
  });
  it("period < 1 is all nulls", () => {
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
  });
  it("period longer than the series is all nulls", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("seeds with the SMA of the first window", () => {
    const out = ema([2, 4, 6, 8], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(3); // SMA(2,4)
    // k = 2/3: 6*2/3 + 3*1/3 = 5; 8*2/3 + 5/3 = 7
    expect(out[2]).toBeCloseTo(5, 12);
    expect(out[3]).toBeCloseTo(7, 12);
  });
  it("series shorter than the period is all nulls", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe("niceStep", () => {
  it("picks from the {1,2,2.5,5,10}·10^k ladder", () => {
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(10, 4)).toBe(2.5);
    expect(niceStep(4, 4)).toBe(1);
    expect(niceStep(0.9, 3)).toBeCloseTo(0.5, 12);
  });
  it("degenerate spans fall back to 1", () => {
    expect(niceStep(0, 4)).toBe(1);
    expect(niceStep(-5, 4)).toBe(1);
    expect(niceStep(NaN, 4)).toBe(1);
  });
});

describe("niceDomain", () => {
  const INTERVALS = 4;

  function checkInvariants(lo: number, hi: number) {
    const d = niceDomain(lo, hi, INTERVALS);
    expect(d.hi).toBeGreaterThan(d.lo);
    expect(d.hi - d.lo).toBeCloseTo(d.step * INTERVALS, 8);
    expect(d.ticks).toHaveLength(INTERVALS + 1);
    // ticks are evenly spaced from lo to hi
    d.ticks.forEach((t, i) =>
      expect(t).toBeCloseTo(d.lo + i * d.step, 8),
    );
    return d;
  }

  it("simple round span stays exact", () => {
    expect(niceDomain(0, 100, 4)).toEqual({
      lo: 0,
      hi: 100,
      step: 25,
      ticks: [0, 25, 50, 75, 100],
    });
  });

  it("ragged span snaps outward and still covers the data", () => {
    const d = checkInvariants(3, 97);
    expect(d.lo).toBeLessThanOrEqual(3);
    expect(d.hi).toBeGreaterThanOrEqual(97);
    expect(d).toMatchObject({ lo: 0, hi: 100, step: 25 });
  });

  it("flat window (hi === lo) synthesizes a span around the value", () => {
    const d = checkInvariants(50_000, 50_000);
    expect(d.lo).toBeLessThan(50_000);
    expect(d.hi).toBeGreaterThan(50_000);
  });

  it("flat window at zero still produces a usable domain", () => {
    const d = checkInvariants(0, 0);
    expect(d.lo).toBeLessThan(0);
    expect(d.hi).toBeGreaterThan(0);
  });

  it("all-negative domains cover the data", () => {
    const d = checkInvariants(-83, -17);
    expect(d.lo).toBeLessThanOrEqual(-83);
    expect(d.hi).toBeGreaterThanOrEqual(-17);
  });

  it("domains crossing zero cover the data", () => {
    const d = checkInvariants(-12.4, 31.9);
    expect(d.lo).toBeLessThanOrEqual(-12.4);
    expect(d.hi).toBeGreaterThanOrEqual(31.9);
  });

  it("tiny spans keep sub-unit steps instead of collapsing", () => {
    const d = checkInvariants(1.00001, 1.00009);
    expect(d.step).toBeLessThan(0.001);
    expect(d.lo).toBeLessThanOrEqual(1.00001);
    expect(d.hi).toBeGreaterThanOrEqual(1.00009);
  });

  it("very large crypto-price spans stay nice", () => {
    const d = checkInvariants(6_950_000, 7_310_000);
    expect(d.lo).toBeLessThanOrEqual(6_950_000);
    expect(d.hi).toBeGreaterThanOrEqual(7_310_000);
    // 100k steps can't cover 6.95M-7.31M from a floor-aligned lo, so the
    // step bumps to the next nice value.
    expect(d.step).toBeCloseTo(200_000, 6);
  });

  it("survives an inverted input without producing an inverted domain", () => {
    const d = niceDomain(5, 3, INTERVALS);
    expect(d.hi).toBeGreaterThan(d.lo);
    expect(d.ticks).toHaveLength(INTERVALS + 1);
  });
});

describe("linePath", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;
  it("breaks and restarts around nulls (indicator warm-up)", () => {
    const d = linePath([1, 2, null, 4, 5], x, y);
    // two pen-down segments: M...L... M...L...
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toBe("M0.0 99.0 L10.0 98.0 M30.0 96.0 L40.0 95.0");
  });
  it("skips non-finite values the same way", () => {
    const d = linePath([1, Infinity, 3], x, y);
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it("empty input gives an empty path", () => {
    expect(linePath([], x, y)).toBe("");
  });
});

describe("areaPath / bandPath / highWaterMark", () => {
  const x = (i: number) => i;
  const y = (v: number) => -v;
  it("areaPath closes down to the floor", () => {
    const d = areaPath([1, 2], x, y, 0);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("areaPath needs at least two points", () => {
    expect(areaPath([1], x, y, 0)).toBe("");
  });
  it("bandPath walks upper forward and lower back", () => {
    const d = bandPath([2, 3], [1, 1], x, y);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("highWaterMark is the running max", () => {
    expect(highWaterMark([3, 1, 4, 2, 5])).toEqual([3, 3, 4, 4, 5]);
  });
});
