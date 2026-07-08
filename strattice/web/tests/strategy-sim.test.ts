import { describe, expect, it } from "vitest";
import {
  sma,
  stdev,
  atr,
  rsi,
  uptrend,
  runSim,
  simulate,
  sanitizeParams,
  mergedParams,
  paramRuleError,
  supertrendStates,
  TEMPLATE_CONFIG,
  FRICTION_PCT,
  type Candle,
} from "@/lib/strategy-sim";
import { BUILTIN_TEMPLATES } from "@/lib/entitlements";
import { fixtureCandles } from "./fixtures";

// ---------- indicator parity ----------

function bar(o: number, h: number, l: number, c: number, v = 100): Candle {
  return { t: 0, o, h, l, c, v };
}

describe("indicators", () => {
  it("sma over an exact window", () => {
    expect(sma([1, 2, 3, 4, 5], 4, 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 4, 2)).toBe(4.5);
    expect(sma([1, 2, 3], 1, 3)).toBeNull(); // not enough data
  });

  it("stdev is the population stdev", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 7, 8)).toBeCloseTo(2, 12);
    expect(stdev([1], 0, 2)).toBeNull();
  });

  it("atr uses the Wilder true range with a simple mean", () => {
    const candles = [
      bar(10, 12, 9, 11),
      bar(11, 14, 10, 13), // TR = max(4, |14-11|, |10-11|) = 4
      bar(13, 15, 12, 14), // TR = max(3, |15-13|, |12-13|) = 3
    ];
    expect(atr(candles, 2, 2)).toBeCloseTo(3.5, 12);
    expect(atr(candles, 1, 2)).toBeNull(); // needs n TRs
  });

  it("rsi is 100 on all-gains and 0-ish on all-losses", () => {
    expect(rsi([1, 2, 3, 4, 5], 4, 4)).toBe(100);
    expect(rsi([5, 4, 3, 2, 1], 4, 4)).toBeCloseTo(0, 12);
    expect(rsi([1, 2], 1, 4)).toBeNull();
  });

  it("uptrend gates on close vs regime SMA", () => {
    const closes = [1, 1, 1, 1, 2]; // close 2 > SMA(4) of last 4
    expect(uptrend(closes, 4, 3)).toBe(true);
    expect(uptrend([2, 2, 2, 2, 1], 4, 3)).toBe(false);
  });

  it("supertrend flips up when close crosses the down band", () => {
    // Falling then sharply rising series: state must end +1.
    const candles = [
      bar(100, 101, 95, 96),
      bar(96, 97, 91, 92),
      bar(92, 93, 87, 88),
      bar(88, 89, 83, 84),
      bar(84, 100, 84, 99),
      bar(99, 112, 99, 111),
    ];
    const states = supertrendStates(candles, candles.length - 1, 2, 1.5);
    expect(states[states.length - 1]).toBe(1);
  });
});

// ---------- param sanitizing ----------

describe("sanitizeParams", () => {
  it("clamps to spec bounds and rounds integer fields", () => {
    const out = sanitizeParams("tsmom", { lookback: 999.7, min_return: -5 });
    expect(out).toEqual({ lookback: 200, min_return: 0.02 });
  });

  it("drops unknown keys and non-finite values", () => {
    expect(
      sanitizeParams("tsmom", { evil: 1, lookback: NaN, min_return: "x" }),
    ).toBeNull();
  });

  it("returns null when the result equals stock", () => {
    const stock = TEMPLATE_CONFIG.tsmom.params;
    expect(sanitizeParams("tsmom", { lookback: stock.lookback })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(() => sanitizeParams("tsmom", [1, 2])).toThrow();
    expect(sanitizeParams("tsmom", null)).toBeNull();
  });

  it("enforces cross-field rules (fast < slow)", () => {
    expect(() =>
      sanitizeParams("ma_crossover", { fast: 50, slow: 10 }),
    ).toThrow(/Fast SMA/);
    expect(paramRuleError("ma_crossover", { fast: 5, slow: 20 })).toBeNull();
  });

  it("mergedParams overlays only editable keys", () => {
    const p = mergedParams("tsmom", { lookback: 40, expected_move_pct: 99 });
    expect(p.lookback).toBe(40);
    expect(p.expected_move_pct).toBe(
      TEMPLATE_CONFIG.tsmom.params.expected_move_pct, // not editable -> stock
    );
  });
});

// ---------- exit engine on hand-made candles ----------

describe("runSim exits", () => {
  const alwaysEnter = () => true;

  it("hard stop fires when close breaches entry*(1-stop)", () => {
    const candles = [
      bar(100, 101, 99, 100),
      bar(100, 101, 99, 100), // entry at close 100
      bar(100, 100, 89, 90), // -10% -> stop at 5%
      bar(90, 91, 89, 90),
    ];
    const r = runSim(candles, alwaysEnter, {
      stopLossPct: 0.05,
      takeProfitPct: 0,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 0,
    });
    expect(r.trades[0]).toMatchObject({
      entryIdx: 1,
      exitIdx: 2,
      reason: "stop",
    });
    expect(r.trades[0].grossPct).toBeCloseTo(-10, 10);
    expect(r.trades[0].netPct).toBeCloseTo(-10 - FRICTION_PCT, 10);
  });

  it("take-profit fires and the friction is charged", () => {
    const candles = [
      bar(100, 101, 99, 100),
      bar(100, 101, 99, 100), // entry
      bar(100, 111, 100, 110), // +10% -> target at 8%
    ];
    const r = runSim(candles, alwaysEnter, {
      stopLossPct: 0.5,
      takeProfitPct: 0.08,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 0,
    });
    expect(r.trades[0].reason).toBe("target");
    expect(r.trades[0].netPct).toBeCloseTo(10 - FRICTION_PCT, 10);
  });

  it("time-stop closes a going-nowhere position", () => {
    const flat = Array.from({ length: 10 }, () => bar(100, 100.5, 99.5, 100));
    const r = runSim(flat, alwaysEnter, {
      stopLossPct: 0.5,
      takeProfitPct: 0,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 3,
    });
    expect(r.trades[0]).toMatchObject({ entryIdx: 1, exitIdx: 4, reason: "time" });
  });

  it("a position still open at the window end is reported, not counted closed", () => {
    const candles = [bar(100, 101, 99, 100), bar(100, 106, 100, 105)];
    const r = runSim(candles, alwaysEnter, {
      stopLossPct: 0.5,
      takeProfitPct: 0,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 0,
    });
    expect(r.trades[0].reason).toBe("open");
    expect(r.closed).toBe(0);
    expect(r.winRate).toBeNull();
  });

  it("no entries -> empty result with buy&hold still computed", () => {
    const candles = [bar(100, 101, 99, 100), bar(100, 111, 100, 110)];
    const r = runSim(candles, () => false, {
      stopLossPct: 0.05,
      takeProfitPct: 0,
      chandelierK: 0,
      atrPeriod: 14,
      maxHoldBars: 0,
    });
    expect(r.trades).toHaveLength(0);
    expect(r.buyHoldPct).toBeCloseTo(10, 10);
    expect(r.exposurePct).toBe(0);
  });
});

// ---------- golden snapshot: every builtin template on the fixed fixture ----------
// Any change to entry logic, exits, params or friction shows up as a reviewable
// snapshot diff. Update deliberately with `vitest -u` and review the diff.

describe("simulate snapshots (fixtureCandles(500, seed 42))", () => {
  const candles = fixtureCandles(500, 42);

  it("fixture itself is stable", () => {
    expect(candles).toHaveLength(500);
    expect(candles[0]).toEqual({ t: 1704067200000, o: 100, h: 101.45, l: 98.98, c: 100.9, v: 1572 });
    expect(candles[499].c).toMatchSnapshot();
  });

  for (const template of BUILTIN_TEMPLATES) {
    it(`${template} trades are stable`, () => {
      const r = simulate(template, candles);
      expect({
        closed: r.closed,
        wins: r.wins,
        totalNetPct: r.totalNetPct.toFixed(2),
        buyHoldPct: r.buyHoldPct.toFixed(2),
        exposurePct: r.exposurePct.toFixed(1),
        trades: r.trades.map((t) => ({
          entry: t.entryIdx,
          exit: t.exitIdx,
          reason: t.reason,
          netPct: t.netPct.toFixed(2),
        })),
      }).toMatchSnapshot();
    });
  }
});
