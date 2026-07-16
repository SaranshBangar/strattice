"use client";
// "Watch a strategy trade" - a looping, scripted replay for the landing page.
// Synthetic daily candles (bundled, no network) play back bar by bar: the fast
// average crosses above the slow one → entry marker + callout, the holding
// period shades in as it extends, the cross back down → exit marker, and a
// running P&L chip counts along. Axes are fixed for the whole loop; only the
// series draws in. Under prefers-reduced-motion the finished frame renders
// statically.
import { useEffect, useRef, useState } from "react";
import { niceDomain, sma } from "@/lib/chart-math";
import {
  C,
  ChartFrame,
  GridLines,
  LegendKey,
  Marker,
  XBand,
} from "@/components/chart/primitives";
import { usePrefersReducedMotion } from "@/components/chart/LiveTape";

// ---- Scripted market: deterministic random walk with a clean trend arc ----
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

const BARS = 120;
const START_BAR = 34; // playback starts once the slow average is warm
const STAKE = 10_000;

const CLOSES: number[] = (() => {
  const rnd = mulberry32(20260708);
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < BARS; i++) {
    // three regimes: drift down / trend up / roll over
    const drift = i < 40 ? -0.0012 : i < 92 ? 0.009 : -0.008;
    const noise = (rnd() - 0.5) * 0.022;
    p = Math.max(40, p * (1 + drift + noise));
    out.push(p);
  }
  return out;
})();

const FAST = sma(CLOSES, 10);
const SLOW = sma(CLOSES, 30);

// Entry: first fast-over-slow cross after warm-up. Exit: first cross back down.
const ENTRY = (() => {
  for (let i = 31; i < BARS; i++) {
    if (
      FAST[i] != null &&
      SLOW[i] != null &&
      FAST[i - 1] != null &&
      SLOW[i - 1] != null &&
      FAST[i]! > SLOW[i]! &&
      FAST[i - 1]! <= SLOW[i - 1]!
    )
      return i;
  }
  return 46;
})();
const EXIT = (() => {
  for (let i = ENTRY + 5; i < BARS; i++) {
    if (
      FAST[i] != null &&
      SLOW[i] != null &&
      FAST[i]! < SLOW[i]! &&
      FAST[i - 1]! >= SLOW[i - 1]!
    )
      return i;
  }
  return BARS - 8;
})();

// Fixed domain over everything that will ever be drawn - the axes never move.
const DOMAIN = (() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < BARS; i++) {
    lo = Math.min(lo, CLOSES[i]);
    hi = Math.max(hi, CLOSES[i]);
    if (FAST[i] != null) {
      lo = Math.min(lo, FAST[i]!);
      hi = Math.max(hi, FAST[i]!);
    }
    if (SLOW[i] != null) {
      lo = Math.min(lo, SLOW[i]!);
      hi = Math.max(hi, SLOW[i]!);
    }
  }
  const pad = (hi - lo) * 0.08;
  return niceDomain(lo - pad, hi + pad, 4);
})();

const W = 1000;
const H = 300;
const X = (i: number) => (i / (BARS - 1)) * W;
const Y = (v: number) => ((DOMAIN.hi - v) / (DOMAIN.hi - DOMAIN.lo)) * H;

function pathUpTo(series: (number | null)[], upto: number) {
  let d = "";
  let pen = false;
  for (let i = 0; i <= upto && i < series.length; i++) {
    const v = series[i];
    if (v == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
    pen = true;
  }
  return d.trimEnd();
}

const STEP_MS = 80;
const HOLD_MS = 2600;

export function StrategyDemo() {
  const reduce = usePrefersReducedMotion();
  const [bar, setBar] = useState(START_BAR);
  const holdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (reduce) {
      setBar(BARS - 1);
      return;
    }
    const id = window.setInterval(() => {
      setBar((b) => {
        if (b >= BARS - 1) return b; // parked at the end; the hold timer resets
        return b + 1;
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [reduce]);

  // Loop: hold the finished frame, then restart.
  useEffect(() => {
    if (reduce || bar < BARS - 1) return;
    holdRef.current = window.setTimeout(() => setBar(START_BAR), HOLD_MS);
    return () => window.clearTimeout(holdRef.current);
  }, [bar, reduce]);

  const inTrade = bar >= ENTRY;
  const exited = bar >= EXIT;
  const holdEnd = Math.min(bar, EXIT);
  const entryPrice = CLOSES[ENTRY];
  const markPrice = CLOSES[exited ? EXIT : bar];
  const pnl = inTrade ? (STAKE / entryPrice) * (markPrice - entryPrice) : 0;
  const pnlPct = inTrade ? ((markPrice - entryPrice) / entryPrice) * 100 : 0;
  const pnlTone = pnl >= 0 ? C.gain : C.loss;

  const entryChipVisible = inTrade && bar <= ENTRY + 28;
  const exitChipVisible = exited && bar <= EXIT + 28;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white/[0.03] px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
          watch_a_strategy_trade
        </span>
        <span className="font-mono text-[11px] text-muted">
          ma_crossover · synthetic candles · looping replay
        </span>
      </div>

      <div className="p-4">
        <ChartFrame
          height={230}
          yTicks={[...DOMAIN.ticks].reverse()}
          xTicks={["day 1", "day 30", "day 60", "day 90", "day 120"]}
          fmtY={(v) => `₹${Math.round(v)}`}
          legend={
            <LegendKey
              items={[
                { label: "price", color: C.gain, kind: "line" },
                { label: "fast avg · 10d", color: C.accent, kind: "line" },
                { label: "slow avg · 30d", color: C.accentHi, kind: "dash" },
                { label: "holding", color: C.gain, kind: "area" },
              ]}
            />
          }
          note="The rule: buy when the fast average crosses above the slow one, sell when it crosses back. That's the whole strategy — the bot just never blinks."
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            width="100%"
            style={{ height: 230, display: "block" }}
            role="img"
            aria-label="Animated demo of a moving-average crossover strategy entering and exiting a trade"
          >
            <GridLines n={4} W={W} H={H} />
            {[0, 1, 2, 3, 4].map((j) => (
              <line
                key={`v${j}`}
                x1={(j / 4) * W}
                x2={(j / 4) * W}
                y1={0}
                y2={H}
                stroke={C.line}
                strokeWidth={1}
                strokeOpacity={0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line x1={0} x2={0} y1={0} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={W} y1={H} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />

            {inTrade && (
              <XBand
                x1={X(ENTRY)}
                x2={X(holdEnd)}
                H={H}
                color={C.gain}
                opacity={0.08}
              />
            )}

            <defs>
              <linearGradient id="sd-price-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.gain} stopOpacity={0.28} />
                <stop offset="100%" stopColor={C.gain} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path
              d={`${pathUpTo(CLOSES, bar)} L${X(Math.min(bar, CLOSES.length - 1)).toFixed(1)} ${H} L${X(0).toFixed(1)} ${H} Z`}
              fill="url(#sd-price-fill)"
              stroke="none"
            />

            <path
              d={pathUpTo(SLOW, bar)}
              fill="none"
              stroke={C.accentHi}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={pathUpTo(FAST, bar)}
              fill="none"
              stroke={C.accent}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={pathUpTo(CLOSES, bar)}
              fill="none"
              stroke={C.gain}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>

          {inTrade && (
            <Marker
              xFrac={X(ENTRY) / W}
              yFrac={Y(CLOSES[ENTRY]) / H}
              kind="entry"
              color={C.gain}
            />
          )}
          {exited && (
            <Marker
              xFrac={X(EXIT) / W}
              yFrac={Y(CLOSES[EXIT]) / H}
              kind="exit"
              color={C.loss}
            />
          )}

          {entryChipVisible && (
            <span
              className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-panel/95 px-2 py-1 font-mono text-[10px] text-gain shadow-lg backdrop-blur"
              style={{
                left: `${Math.max(12, Math.min(88, (X(ENTRY) / W) * 100))}%`,
                top: `${Math.max(4, (Y(CLOSES[ENTRY]) / H) * 100 - 16)}%`,
              }}
            >
              rule fires → bot buys
            </span>
          )}
          {exitChipVisible && (
            <span
              className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-panel/95 px-2 py-1 font-mono text-[10px] text-loss shadow-lg backdrop-blur"
              style={{
                left: `${Math.max(12, Math.min(88, (X(EXIT) / W) * 100))}%`,
                top: `${Math.min(90, (Y(CLOSES[EXIT]) / H) * 100 + 10)}%`,
              }}
            >
              stop rule → bot sells
            </span>
          )}

          {/* Running P&L on a ₹10,000 practice stake */}
          <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-panel/95 px-2.5 py-1.5 text-right font-mono shadow-lg backdrop-blur">
            <div className="text-[9px] uppercase tracking-wider text-faint">
              {exited ? "trade closed" : inTrade ? "in trade" : "waiting for signal"}
            </div>
            <div
              className="mt-0.5 text-sm font-semibold tnum"
              style={{ color: inTrade ? pnlTone : "#828AA0" }}
            >
              {inTrade
                ? `${pnl >= 0 ? "+" : "−"}₹${Math.abs(pnl).toFixed(0)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`
                : "—"}
            </div>
            <div className="text-[9px] text-faint">on ₹10,000 practice</div>
          </div>
        </ChartFrame>
      </div>

      <div className="bg-white/[0.03] px-4 py-2 font-mono text-[11px] text-faint">
        scripted demo on made-up prices — real previews run on live market data
      </div>
    </section>
  );
}
