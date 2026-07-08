// The /demo dashboard's whole promise is that its numbers reconcile: daily P&L is
// the day-over-day equity change, and each day's P&L is carried exactly by that
// day's closed sell trades. These tests hold the generator to that promise.
import { describe, expect, it } from "vitest";
import { demoData } from "@/lib/demo-data";

const BASE = 1000;
const EPS = 1e-6;

const data = demoData();

function sellsByDay() {
  const m = new Map<string, number>();
  for (const t of data.trades) {
    if (t.side !== "sell") continue;
    const day = t.ts.slice(0, 10);
    m.set(day, (m.get(day) ?? 0) + t.realized_pnl);
  }
  return m;
}

describe("demo data reconciliation", () => {
  it("is deterministic (values identical across builds)", () => {
    const a = demoData();
    const b = demoData();
    expect(a.equityVals).toEqual(b.equityVals);
    expect(a.trades).toEqual(b.trades);
    expect(a.stats).toEqual(b.stats);
  });

  it("daily P&L equals the day-over-day equity change", () => {
    // equityVals[i] - equityVals[i-1] must equal the reported pnl of that day.
    const pnlByDay = new Map(data.dailyPnl.map((d) => [d.day, d.pnl]));
    for (let i = 1; i < data.equitySeries.length; i++) {
      const day = data.equitySeries[i].ts.slice(0, 10);
      const diff = data.equityVals[i] - data.equityVals[i - 1];
      const reported = pnlByDay.get(day);
      if (reported === undefined) continue; // dailyPnl only carries the last 30 days
      expect(diff).toBeCloseTo(reported, 6);
    }
  });

  it("each day's P&L is carried exactly by that day's sell trades", () => {
    const sells = sellsByDay();
    for (const { day, pnl } of data.dailyPnl) {
      expect(sells.get(day) ?? 0).toBeCloseTo(pnl, 6);
    }
  });

  it("total paper P&L = final equity - base = sum of all sell P&L", () => {
    const last = data.equityVals[data.equityVals.length - 1];
    expect(data.stats.paperPnl).toBeCloseTo(last - BASE, 6);
    const totalSells = data.trades
      .filter((t) => t.side === "sell")
      .reduce((a, t) => a + t.realized_pnl, 0);
    expect(totalSells).toBeCloseTo(last - BASE, 4);
  });

  it("every sell has an earlier matching buy of the same qty and strategy", () => {
    const buys = data.trades.filter((t) => t.side === "buy");
    for (const s of data.trades.filter((t) => t.side === "sell")) {
      const buy = buys.find(
        (b) =>
          b.strategy === s.strategy &&
          Math.abs(b.qty - s.qty) < EPS &&
          b.ts < s.ts,
      );
      expect(buy, `no matching buy for sell on ${s.ts}`).toBeTruthy();
      // (sell - buy) * qty carries the realized pnl
      expect((s.price - buy!.price) * s.qty).toBeCloseTo(s.realized_pnl, 4);
    }
  });

  it("TDS is 1% of sell notional (India VDA rules), zero on buys", () => {
    for (const t of data.trades) {
      if (t.side === "sell")
        expect(t.tds).toBeCloseTo(
          Math.round(t.notional * 0.01 * 100) / 100,
          6,
        );
      else expect(t.tds).toBe(0);
    }
  });

  it("win/loss stats agree with the trades", () => {
    const sells = data.trades.filter((t) => t.side === "sell");
    expect(data.stats.wins).toBe(
      sells.filter((t) => t.realized_pnl > 0).length,
    );
    expect(data.stats.losses).toBe(
      sells.filter((t) => t.realized_pnl < 0).length,
    );
    expect(data.stats.paperTrades).toBe(data.trades.length);
    expect(data.stats.liveTrades).toBe(0); // demo is paper-only
  });

  it("per-strategy breakdown sums back to the total", () => {
    const total = data.breakdown.reduce((a, s) => a + s.pnl, 0);
    expect(total).toBeCloseTo(data.stats.paperPnl, 1);
  });

  it("latest equity row mirrors the series tail", () => {
    expect(data.latestEquity.equity).toBe(
      data.equityVals[data.equityVals.length - 1],
    );
    expect(data.latestEquity.ts).toBe(
      data.equitySeries[data.equitySeries.length - 1].ts,
    );
  });

  it("everything is marked dry-run (simulated, never live)", () => {
    for (const t of data.trades) expect(t.dry_run).toBe(1);
  });
});
