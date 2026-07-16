// Deterministic sample data for the public /demo dashboard. A seeded PRNG
// generates ~90 days of plausible paper-trading history shaped exactly like
// lib/queries.ts outputs, and every number reconciles: daily P&L is the
// day-over-day equity change, and each day's P&L is carried by that day's
// closed sell trades. Only the date labels move with the clock - the values
// are identical on every render. No DB, no auth, no network.
import type { Trade } from "@/components/TradesTable";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = 90;
const BASE = 1000; // the engine's paper base

// Lower-priced markets on purpose: a ₹1,000 paper book buys quantities that
// still read as non-zero at the tables' two-decimal formatting.
const STRATS = [
  { strategy: "tsmom", market: "I-SOL_INR", px: 12_850 },
  { strategy: "momentum", market: "I-DOGE_INR", px: 18.4 },
  { strategy: "ma_crossover", market: "I-XRP_INR", px: 210 },
] as const;

function dayISO(offsetDays: number) {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function build() {
  const rnd = mulberry32(1337_2026);

  // --- Equity walk: gentle up-drift with two engineered drawdown windows ---
  const equity: number[] = [BASE];
  const dailyPnl: number[] = [];
  for (let i = 1; i <= DAYS; i++) {
    const inDD = (i >= 28 && i <= 37) || (i >= 61 && i <= 67);
    const drift = inDD ? -0.011 : 0.0042;
    const noise = (rnd() - 0.5) * 0.016;
    // Roughly a third of days are flat - the bot often holds or sits out.
    const active = rnd() > 0.34;
    const pnl = active
      ? Math.round(equity[i - 1] * (drift + noise) * 100) / 100
      : 0;
    dailyPnl.push(pnl);
    equity.push(Math.round((equity[i - 1] + pnl) * 100) / 100);
  }

  const series = equity.slice(1).map((eq, i) => ({
    ts: `${dayISO(DAYS - 1 - i)} 17:30:00`,
    equity: eq,
  }));

  // --- Trades: each non-flat day closes one sell carrying that day's P&L,
  //     paired with a buy a few days earlier. Fully reconciled by design. ---
  const trades: Trade[] = [];
  let si = 0;
  for (let i = 0; i < DAYS; i++) {
    const pnl = dailyPnl[i];
    if (pnl === 0) continue;
    const s = STRATS[si++ % STRATS.length];
    const wiggle = 1 + (rnd() - 0.5) * 0.06;
    const sellPrice = s.px * wiggle;
    const notional = 700 + rnd() * 800; // position sizes fit a ₹1,000 book
    const qty = notional / sellPrice;
    const buyPrice = sellPrice - pnl / qty;
    const dayOffset = DAYS - 1 - i;
    const holdDays = 2 + Math.floor(rnd() * 5);
    trades.push({
      strategy: s.strategy,
      market: s.market,
      side: "buy",
      qty,
      price: buyPrice,
      notional: qty * buyPrice,
      status: "filled",
      realized_pnl: 0,
      tds: 0,
      dry_run: 1,
      ts: `${dayISO(dayOffset + holdDays)}T10:15:00`,
    });
    trades.push({
      strategy: s.strategy,
      market: s.market,
      side: "sell",
      qty,
      price: sellPrice,
      notional,
      status: "filled",
      realized_pnl: pnl,
      tds: Math.round(notional * 0.01 * 100) / 100,
      dry_run: 1,
      ts: `${dayISO(dayOffset)}T14:45:00`,
    });
  }
  trades.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  // --- Aggregates, computed from the trades so everything agrees ---
  const sells = trades.filter((t) => t.side === "sell");
  const wins = sells.filter((t) => t.realized_pnl > 0).length;
  const losses = sells.filter((t) => t.realized_pnl < 0).length;
  const byStrategy = STRATS.map((s) => {
    const mine = sells.filter((t) => t.strategy === s.strategy);
    return {
      strategy: s.strategy,
      trades: mine.length * 2,
      wins: mine.filter((t) => t.realized_pnl > 0).length,
      losses: mine.filter((t) => t.realized_pnl < 0).length,
      pnl:
        Math.round(mine.reduce((a, t) => a + t.realized_pnl, 0) * 100) / 100,
    };
  });

  const positions = [
    {
      strategy: "tsmom",
      market: "I-SOL_INR",
      qty: 0.06,
      avg_price: 12_480,
    },
    {
      strategy: "ma_crossover",
      market: "I-XRP_INR",
      qty: 3.8,
      avg_price: 204.6,
    },
  ];

  const last = equity[equity.length - 1];
  // Illustrative mark-to-market: each open position drifted a few percent from its
  // average cost since entry - just enough to make the Unrealized P&L card non-zero.
  const unrealizedPnl =
    Math.round(
      positions.reduce((a, p) => a + p.qty * p.avg_price * 0.025, 0) * 100,
    ) / 100;

  // Illustrative mark-to-market path for the Unrealized P&L card's sparkline: a gentle
  // seeded walk the same length as the equity curve that lands on the current unrealizedPnl.
  const unrealizedSeries: number[] = [];
  let uw = unrealizedPnl * 0.3;
  const uStep = Math.max(0.5, Math.abs(unrealizedPnl) * 0.18);
  for (let i = 1; i < equity.length; i++) {
    uw += (rnd() - 0.48) * uStep;
    unrealizedSeries.push(Math.round(uw * 100) / 100);
  }
  unrealizedSeries[unrealizedSeries.length - 1] = unrealizedPnl;

  return {
    equitySeries: series,
    equityVals: equity.slice(1),
    unrealizedSeries,
    latestEquity: {
      equity: last,
      unrealized_pnl: unrealizedPnl,
      realized_today: dailyPnl[dailyPnl.length - 1],
      trades_today: dailyPnl[dailyPnl.length - 1] === 0 ? 0 : 2,
      ts: series[series.length - 1].ts,
    },
    dailyPnl: dailyPnl
      .map((pnl, i) => ({ day: dayISO(DAYS - 1 - i), pnl }))
      .slice(-30),
    trades,
    positions,
    breakdown: byStrategy,
    stats: {
      wins,
      losses,
      paperPnl: Math.round((last - BASE) * 100) / 100,
      paperTrades: trades.length,
      livePnl: 0,
      liveTrades: 0,
    },
  };
}

export type DemoData = ReturnType<typeof build>;

// Values are deterministic; dates are relative to "now" so the demo always
// looks current. Rebuilt per request (the page is dynamic), cheap either way.
export function demoData(): DemoData {
  return build();
}
