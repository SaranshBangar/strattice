import { describe, expect, it } from "vitest";
import {
  walkForward,
  simulate,
  type SimResult,
  type SimTrade,
  type Candle,
} from "@/lib/strategy-sim";
import { fixtureCandles } from "./fixtures";

function trade(
  entryIdx: number,
  exitIdx: number | null,
  netPct: number,
): SimTrade {
  return {
    entryIdx,
    exitIdx,
    entryPrice: 100,
    exitPrice: 100 * (1 + netPct / 100),
    grossPct: netPct,
    netPct,
    reason: exitIdx === null ? "open" : "stop",
  };
}

function simOf(trades: SimTrade[]): SimResult {
  const closed = trades.filter((t) => t.exitIdx !== null);
  return {
    trades,
    closed: closed.length,
    wins: closed.filter((t) => t.netPct > 0).length,
    winRate: null,
    totalNetPct: 0,
    buyHoldPct: 0,
    exposurePct: 0,
  };
}

function flatCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 86_400_000,
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 100,
  }));
}

describe("walkForward", () => {
  it("partitions the window into equal consecutive folds", () => {
    const wf = walkForward(simOf([]), flatCandles(500), 5);
    expect(wf.folds).toHaveLength(5);
    expect(wf.folds.map((f) => [f.fromIdx, f.toIdx])).toEqual([
      [0, 100],
      [100, 200],
      [200, 300],
      [300, 400],
      [400, 500],
    ]);
    expect(wf.tradedFolds).toBe(0);
    expect(wf.medianNetPct).toBeNull();
  });

  it("attributes a trade to the fold its entry falls in", () => {
    const sim = simOf([
      trade(50, 120, 10), // enters fold 1, exits in fold 2 -> counted in fold 1
      trade(250, 260, -5), // fold 3
      trade(450, null, 99), // still open -> entries but not closed
    ]);
    const wf = walkForward(sim, flatCandles(500), 5);
    expect(wf.folds[0]).toMatchObject({ entries: 1, closed: 1 });
    expect(wf.folds[0].netPct).toBeCloseTo(10, 10);
    expect(wf.folds[2]).toMatchObject({ entries: 1, closed: 1 });
    expect(wf.folds[2].netPct).toBeCloseTo(-5, 10);
    expect(wf.folds[4]).toMatchObject({ entries: 1, closed: 0, netPct: 0 });
    expect(wf.positiveFolds).toBe(1);
    expect(wf.tradedFolds).toBe(2);
    expect(wf.medianNetPct).toBeCloseTo(2.5, 10); // median of {10, -5}
  });

  it("compounds net returns and tracks drawdown within a fold", () => {
    // +10% then -10%: eq 1.10 -> 0.99, drawdown 10% off the 1.10 peak.
    const sim = simOf([trade(10, 20, 10), trade(30, 40, -10)]);
    const wf = walkForward(sim, flatCandles(100), 1);
    const f = wf.folds[0];
    expect(f.netPct).toBeCloseTo(-1, 10);
    expect(f.maxDrawdownPct).toBeCloseTo(10, 10);
    expect(f.profitFactor).toBeCloseTo(1, 10);
    expect(wf.worstDrawdownPct).toBeCloseTo(10, 10);
  });

  it("profit factor is null with no losers (nothing to divide by)", () => {
    const sim = simOf([trade(10, 20, 5), trade(30, 40, 3)]);
    const wf = walkForward(sim, flatCandles(100), 1);
    expect(wf.folds[0].profitFactor).toBeNull();
    expect(wf.folds[0].netPct).toBeCloseTo(8.15, 10); // 1.05 * 1.03
  });

  it("caps the fold count for short windows instead of degenerating", () => {
    const wf = walkForward(simOf([]), flatCandles(7), 5);
    expect(wf.folds.length).toBeLessThanOrEqual(3);
    expect(wf.folds[wf.folds.length - 1].toIdx).toBe(7);
  });

  it("snapshot: tsmom folds on the fixture stay stable", () => {
    const candles = fixtureCandles(500, 42);
    const wf = walkForward(simulate("tsmom", candles), candles, 5);
    expect(
      wf.folds.map((f) => ({
        fold: f.fold,
        closed: f.closed,
        netPct: f.netPct.toFixed(2),
        dd: f.maxDrawdownPct.toFixed(2),
        pf: f.profitFactor === null ? null : f.profitFactor.toFixed(2),
      })),
    ).toMatchSnapshot();
  });
});
