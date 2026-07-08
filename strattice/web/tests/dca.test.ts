import { describe, expect, it } from "vitest";
import {
  simulateDca,
  BUY_FRICTION_PCT,
  SELL_FRICTION_PCT,
  FRICTION_PCT,
  type Candle,
} from "@/lib/strategy-sim";
import { fixtureCandles } from "./fixtures";

const buyKeep = 1 - BUY_FRICTION_PCT / 100;
const sellKeep = 1 - SELL_FRICTION_PCT / 100;

function bars(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    t: i * 86_400_000,
    o: c,
    h: c,
    l: c,
    c,
    v: 100,
  }));
}

describe("simulateDca", () => {
  it("per-side friction constants reconcile with the round-trip figure", () => {
    expect(BUY_FRICTION_PCT + SELL_FRICTION_PCT).toBeCloseTo(FRICTION_PCT, 1);
  });

  it("buys on schedule, first bar included", () => {
    const r = simulateDca(bars([100, 100, 100, 100, 100, 100, 100]), 3, 300);
    expect(r.buys.map((b) => b.idx)).toEqual([0, 3, 6]);
    expect(r.invested).toBe(900);
  });

  it("flat market: value lags contributions by exactly the buy friction", () => {
    const r = simulateDca(bars([100, 100, 100]), 1, 100);
    expect(r.invested).toBe(300);
    expect(r.units).toBeCloseTo(3 * buyKeep, 12);
    expect(r.finalValue).toBeCloseTo(300 * buyKeep, 10);
    expect(r.grossPct).toBeCloseTo((buyKeep - 1) * 100, 8);
    expect(r.netIfSoldPct).toBeCloseTo((buyKeep * sellKeep - 1) * 100, 8);
  });

  it("falling market: DCA's average cost beats the lump sum", () => {
    const r = simulateDca(bars([100, 80, 60, 40]), 1, 100);
    // avg cost is the harmonic-style average, well below the 100 start
    expect(r.avgCost!).toBeLessThan(70);
    expect(r.netIfSoldPct).toBeGreaterThan(r.lumpSumNetPct);
    expect(r.netIfSoldPct).toBeLessThan(0); // still a loss - DCA doesn't avoid losses
  });

  it("rising market: the lump sum beats DCA (regret works both ways)", () => {
    const r = simulateDca(bars([100, 120, 140, 160]), 1, 100);
    expect(r.lumpSumNetPct).toBeGreaterThan(r.netIfSoldPct);
    expect(r.netIfSoldPct).toBeGreaterThan(0);
  });

  it("drawdown tracks value vs contributions, not raw price", () => {
    // Price round-trips 100 -> 50 -> 100: buys at the bottom mean the
    // portfolio recovers past its old peak ratio.
    const r = simulateDca(bars([100, 50, 100]), 1, 100);
    expect(r.maxDrawdownPct).toBeGreaterThan(0);
    expect(r.maxDrawdownPct).toBeLessThan(60);
    expect(r.netIfSoldPct).toBeGreaterThan(0);
  });

  it("handles empty and single-bar windows without dividing by zero", () => {
    const empty = simulateDca([], 7, 1000);
    expect(empty.invested).toBe(0);
    expect(empty.avgCost).toBeNull();
    expect(empty.netIfSoldPct).toBe(0);
    const one = simulateDca(bars([100]), 7, 1000);
    expect(one.buys).toHaveLength(1);
    expect(one.invested).toBe(1000);
  });

  it("snapshot: weekly ₹1000 on the fixture stays stable", () => {
    const r = simulateDca(fixtureCandles(500, 42), 7, 1000);
    expect({
      buys: r.buys.length,
      invested: r.invested,
      units: r.units.toFixed(4),
      avgCost: r.avgCost!.toFixed(2),
      finalValue: r.finalValue.toFixed(2),
      netIfSoldPct: r.netIfSoldPct.toFixed(2),
      lumpSumNetPct: r.lumpSumNetPct.toFixed(2),
      maxDrawdownPct: r.maxDrawdownPct.toFixed(2),
    }).toMatchSnapshot();
  });
});
