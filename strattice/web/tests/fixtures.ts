// Deterministic synthetic daily candles for simulator snapshot tests. Seeded PRNG,
// no I/O - the same series on every run, on every machine. The shape alternates
// trending legs and pullbacks so trend templates get real entries and the
// protective exits (stop / trail / time) all get exercised.
import type { Candle } from "@/lib/strategy-sim";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~bars daily candles: bull legs (up-drift), bear legs (down-drift), noise on top. */
export function fixtureCandles(bars = 500, seed = 42): Candle[] {
  const rnd = mulberry32(seed);
  const candles: Candle[] = [];
  let close = 100;
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < bars; i++) {
    // 120-bar bull, 60-bar bear, repeating.
    const phase = i % 180;
    const drift = phase < 120 ? 0.005 : -0.006;
    const noise = (rnd() - 0.5) * 0.04;
    const o = close;
    close = Math.max(1, o * (1 + drift + noise));
    const hi = Math.max(o, close) * (1 + rnd() * 0.012);
    const lo = Math.min(o, close) * (1 - rnd() * 0.012);
    const v = 1000 * (0.5 + rnd() * (phase < 120 ? 1.6 : 0.9));
    candles.push({
      t: t0 + i * 86_400_000,
      o: round2(o),
      h: round2(hi),
      l: round2(lo),
      c: round2(close),
      v: Math.round(v),
    });
    close = candles[i].c;
  }
  return candles;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
