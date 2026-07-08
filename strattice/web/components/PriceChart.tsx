"use client";
// Live market price chart. Seeds from /api/candles (Binance klines), then
// streams real trades over Binance WebSocket to tick the last candle in real
// time. The y-axis is sticky-quantized (useStickyDomain) so the scale holds
// still while the price moves. Optional SMA-20/50 overlay lines, a dashed
// "open" reference with a green/red wash for price above/below it, and a
// crosshair + all-series readout on hover. The "2m" range is a true live
// tape: fixed axes, scrolling line (LiveTape).
import { useEffect, useMemo, useRef, useState } from "react";
import { toBinanceSymbol } from "@/lib/binance";
import { Select } from "@/components/Select";
import { Delta } from "@/components/Delta";
import { Spinner } from "@/components/Spinner";
import { sma, bandPath } from "@/lib/chart-math";
import {
  C,
  GridLines,
  LegendKey,
  PlotLabel,
  RefLine,
  SplitArea,
} from "@/components/chart/primitives";
import { useStickyDomain } from "@/components/chart/useStickyDomain";
import { LiveTape, type LiveTapePoint } from "@/components/chart/LiveTape";

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const DEFAULT_MARKETS = [
  "I-BTC_INR",
  "I-ETH_INR",
  "I-SOL_INR",
  "I-XRP_INR",
  "I-DOGE_INR",
  "I-BNB_INR",
];
// Selectable display *windows* (now → now−window), each mapped to the candle
// granularity + count that fills exactly that span. The label is the window,
// not the bar width - "15m" shows the last 15 minutes, not 15-min bars for days.
const WINDOWS: Record<string, { interval: string; limit: number }> = {
  "15m": { interval: "1m", limit: 15 },
  "1h": { interval: "1m", limit: 60 },
  "4h": { interval: "5m", limit: 48 },
  "1d": { interval: "15m", limit: 96 },
  "1w": { interval: "1h", limit: 168 },
};
// "2m" is the live tape - a scrolling last-2-minutes line with fixed axes.
const LIVE_RANGE = "2m";
const RANGES = [LIVE_RANGE, ...Object.keys(WINDOWS)];
const POLL_MS = 20000;
const TAPE_WINDOW_MS = 120_000;
const TAPE_TICK_MS = 500;
const TAPE_KEEP = 320; // window (240 pts) + SMA warm-up slack
const TAPE_CAP = 360; // prune in chunks so the epoch shifts rarely

function label(pair: string) {
  return pair.replace(/^I-/, "").replace("_", "/");
}
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });

export function PriceChart({
  markets,
  fx = { symbol: "$", rate: 1 },
}: {
  markets?: string[];
  // Display conversion from the USD(T) prices Binance streams. rate=1, symbol=$
  // when the user prefers USD or the FX lookup failed.
  fx?: { symbol: string; rate: number };
}) {
  const pairs = useMemo(
    () => Array.from(new Set([...(markets ?? []), ...DEFAULT_MARKETS])),
    [markets],
  );
  const [pair, setPair] = useState(pairs[0] ?? "I-BTC_INR");
  const [range, setRange] = useState("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [tape, setTape] = useState<LiveTapePoint[]>([]);
  const [tapeOpen, setTapeOpen] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const [showMa20, setShowMa20] = useState(true);
  const [showMa50, setShowMa50] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);
  const live = range === LIVE_RANGE;

  useEffect(() => {
    let alive = true;
    const symbol = toBinanceSymbol(pair);
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    const liveRef = { price: null as number | null };

    function connect() {
      if (!symbol) return;
      ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`,
      );
      ws.onmessage = (e) => {
        try {
          const p = Number(JSON.parse(e.data as string).p);
          if (Number.isFinite(p)) liveRef.price = p;
        } catch {}
      };
      ws.onclose = () => {
        if (alive) retry = window.setTimeout(connect, 2000);
      };
    }

    const timers: number[] = [];

    if (range === LIVE_RANGE) {
      // ----- Live tape mode: seed 1s closes, then append every 500ms. -----
      setTape([]);
      setTapeOpen(null);
      setStatus("loading");
      fetch(
        `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1s&limit=${TAPE_KEEP}`,
      )
        .then((r) => r.json())
        .then((rows: unknown) => {
          if (!alive || !Array.isArray(rows)) return;
          const seeded: LiveTapePoint[] = rows
            .map((row) => ({
              t: Number((row as (string | number)[])[0]),
              v: Number((row as string[])[4]),
            }))
            .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
          if (seeded.length) {
            liveRef.price = seeded[seeded.length - 1].v;
            setTape(seeded);
            setTapeOpen(seeded[seeded.length - 1].v);
            setStatus("ok");
          }
        })
        .catch(() => {
          if (alive) setStatus("error");
        });
      connect();
      timers.push(
        window.setInterval(() => {
          const p = liveRef.price;
          if (p == null) return;
          setStatus("ok");
          setTapeOpen((o) => o ?? p);
          setTape((prev) => {
            const next = [...prev, { t: Date.now(), v: p }];
            return next.length > TAPE_CAP
              ? next.slice(next.length - TAPE_KEEP)
              : next;
          });
        }, TAPE_TICK_MS),
      );
    } else {
      // ----- Candle mode: poll klines, fold live trades into the last candle. -----
      async function load(initial: boolean) {
        if (initial) setStatus("loading");
        try {
          const { interval, limit } = WINDOWS[range];
          const r = await fetch(
            `/api/candles?pair=${pair}&interval=${interval}&limit=${limit}`,
          );
          const j = await r.json();
          if (!alive) return;
          if (!r.ok || !Array.isArray(j.candles)) {
            setStatus("error");
            return;
          }
          setCandles(j.candles);
          setStatus("ok");
        } catch {
          if (alive) setStatus("error");
        }
      }
      load(true);
      timers.push(window.setInterval(() => load(false), POLL_MS));
      connect();
      timers.push(
        window.setInterval(() => {
          const p = liveRef.price;
          if (p == null) return;
          liveRef.price = null;
          setCandles((prev) => {
            if (!prev.length) return prev;
            const lastC = prev[prev.length - 1];
            if (p === lastC.c) return prev;
            return [
              ...prev.slice(0, -1),
              {
                ...lastC,
                c: p,
                h: Math.max(lastC.h, p),
                l: Math.min(lastC.l, p),
              },
            ];
          });
        }, 400),
      );
    }

    return () => {
      alive = false;
      for (const t of timers) window.clearInterval(t);
      window.clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [pair, range]);

  const closes = candles.map((c) => c.c);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);
  const ma50 = useMemo(() => sma(closes, 50), [closes]);
  const open = closes[0];
  const last = live ? (tape[tape.length - 1]?.v ?? 0) : closes[closes.length - 1];
  const ref0 = live ? (tapeOpen ?? last) : open;
  const change = ref0 ? ((last - ref0) / ref0) * 100 : 0;
  const up = change >= 0;
  const stroke = up ? C.gain : C.loss;

  const W = 1000,
    H = 260,
    N = 4;
  // Sticky quantized domain: the axis holds still while the last candle ticks.
  // Enabled overlays are included so an MA line never clips.
  let wLo = Infinity;
  let wHi = -Infinity;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] < wLo) wLo = closes[i];
    if (closes[i] > wHi) wHi = closes[i];
    if (showMa20 && ma20[i] != null) {
      wLo = Math.min(wLo, ma20[i]!);
      wHi = Math.max(wHi, ma20[i]!);
    }
    if (showMa50 && ma50[i] != null) {
      wLo = Math.min(wLo, ma50[i]!);
      wHi = Math.max(wHi, ma50[i]!);
    }
  }
  const dom = useStickyDomain(wLo, wHi, {
    intervals: N,
    padFrac: 0.1,
    resetKey: `${pair}|${range}|${showMa20}|${showMa50}`,
  });
  const lo = dom.lo;
  const hi = dom.hi;
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => ((hi - v) / span) * H;
  const path = closes
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join(" ");
  const openBand =
    closes.length > 1 && open != null
      ? bandPath(closes, closes.map(() => open), x, y)
      : "";
  const linePathOf = (s: (number | null)[]) => {
    let d = "";
    let pen = false;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    }
    return d.trimEnd();
  };
  const yTicks = dom.ticks;
  const tfmt = (t: number) => {
    const d = new Date(t);
    // Only the multi-day (1w) window needs dates on the axis; the rest fit in a day.
    return range === "1w"
      ? d.toLocaleDateString("en-IN", { month: "2-digit", day: "2-digit" })
      : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };
  const xk = Math.min(5, candles.length);
  const xTickIdx =
    xk <= 1
      ? candles.slice(0, 1).map(() => 0)
      : Array.from({ length: xk }, (_, j) =>
          Math.round((j * (candles.length - 1)) / (xk - 1)),
        );
  const xTicks = xTickIdx.map((i) => tfmt(candles[i].t));

  function onMove(e: React.MouseEvent) {
    const el = svgRef.current;
    if (!el || closes.length < 2) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (closes.length - 1)));
  }

  const hoverCandle = hover != null ? candles[hover] : null;
  const money = (v: number) => `${fx.symbol}${fmt(v * fx.rate)}`;
  const openVisible =
    open != null && y(open) > -H * 0.02 && y(open) < H * 1.02;

  const legendItems = [
    { label: "price", color: stroke, kind: "line" as const },
    ...(showMa20
      ? [{ label: "MA20", color: C.accent, kind: "line" as const }]
      : []),
    ...(showMa50
      ? [{ label: "MA50", color: C.accentHi, kind: "dash" as const }]
      : []),
    { label: "above open", color: C.gain, kind: "area" as const },
    { label: "below open", color: C.loss, kind: "area" as const },
  ];

  const maChip = (on: boolean, toggle: () => void, text: string) => (
    <button
      onClick={toggle}
      aria-pressed={on}
      className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
        on ? "bg-accent/15 text-accent" : "text-faint hover:text-muted"
      }`}
    >
      {text}
    </button>
  );

  return (
    <section className="card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              {label(pair)}
            </h3>
            {status === "ok" && last > 0 && (
              <>
                <span className="font-mono text-lg font-semibold tnum text-fg">
                  {money(last)}
                </span>
                <Delta value={change} suffix="%" className="text-xs" />
              </>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-faint">
            {status === "loading"
              ? "loading…"
              : status === "error"
                ? "market data unavailable"
                : live
                  ? "scrolling live tape · last 2 minutes"
                  : `last ${range} · streaming live from Binance`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!live && (
            <div className="flex items-center gap-0.5">
              {maChip(showMa20, () => setShowMa20((v) => !v), "MA20")}
              {maChip(showMa50, () => setShowMa50((v) => !v), "MA50")}
            </div>
          )}
          <Select
            size="sm"
            ariaLabel="Market"
            value={pair}
            onChange={setPair}
            options={pairs.map((p) => ({ value: p, label: label(p) }))}
          />
          <Select
            size="sm"
            ariaLabel="Range"
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ value: r, label: r }))}
          />
        </div>
      </div>

      <div className="p-3 pt-0">
        {status === "error" ? (
          <div className="grid h-[260px] place-items-center text-sm text-muted">
            Could not load market data. Retrying…
          </div>
        ) : live ? (
          tape.length < 2 ? (
            <div className="grid h-[260px] place-items-center gap-2 text-sm text-faint">
              <Spinner className="h-5 w-5" />
              Connecting to live tape…
            </div>
          ) : (
            <LiveTape
              points={tape}
              windowMs={TAPE_WINDOW_MS}
              tickMs={TAPE_TICK_MS}
              height={260}
              fmtY={money}
              overlays={[
                {
                  id: "sma20",
                  label: "20-tick avg",
                  period: 20,
                  kind: "sma",
                  color: C.accent,
                },
              ]}
              baseline={tapeOpen}
              domainKey={pair}
              ariaLabel={`${label(pair)} live price, last 2 minutes`}
            />
          )
        ) : closes.length < 2 ? (
          <div className="grid h-[260px] place-items-center gap-2 text-sm text-faint">
            <Spinner className="h-5 w-5" />
            Loading candles…
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex justify-end pr-1">
              <LegendKey items={legendItems} />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "4.5rem 1fr" }}>
              {/* Y (price) axis */}
              <div className="relative" style={{ height: 260 }}>
                {yTicks.map((v, i) => (
                  <span
                    key={`${i}-${fmt(v * fx.rate)}`}
                    className="tick-in absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] leading-none tabular-nums text-faint"
                    style={{ top: `${(i / N) * 100}%` }}
                  >
                    {money(v)}
                  </span>
                ))}
                {/* hovered-price pill hugging the plot edge */}
                {hover != null && (
                  <span
                    className="absolute right-0 z-10 -translate-y-1/2 rounded-sm bg-inset px-1 py-0.5 font-mono text-[10px] leading-none tabular-nums text-dim"
                    style={{ top: `${(y(closes[hover]) / H) * 100}%` }}
                  >
                    {money(closes[hover])}
                  </span>
                )}
              </div>
              {/* Plot */}
              <div
                className="relative"
                style={{ height: 260 }}
                ref={svgRef}
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
              >
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  width="100%"
                  style={{ height: 260, display: "block" }}
                  role="img"
                  aria-label={`${label(pair)} price`}
                >
                  <GridLines n={N} W={W} H={H} />
                  {/* Vertical guidelines aligned with the time-axis ticks */}
                  {xTickIdx.map((idx, i) => (
                    <line
                      key={`vx${i}`}
                      x1={x(idx)}
                      x2={x(idx)}
                      y1={0}
                      y2={H}
                      stroke={C.line}
                      strokeWidth={1}
                      strokeOpacity={0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {/* Axis frame: y-axis on the left, x-axis on the bottom */}
                  <line x1={0} x2={0} y1={0} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <line x1={0} x2={W} y1={H} y2={H} stroke={C.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  {/* Green above the open, red below - where the price has been. */}
                  {openBand && (
                    <SplitArea
                      d={openBand}
                      baselineY={y(open)}
                      W={W}
                      H={H}
                      id="pc-open"
                      opacity={0.08}
                    />
                  )}
                  {openVisible && <RefLine y={y(open)} W={W} />}
                  {showMa50 && (
                    <path
                      d={linePathOf(ma50)}
                      fill="none"
                      stroke={C.accentHi}
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  {showMa20 && (
                    <path
                      d={linePathOf(ma20)}
                      fill="none"
                      stroke={C.accent}
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {hover != null && (
                    <>
                      <line
                        x1={x(hover)}
                        x2={x(hover)}
                        y1={0}
                        y2={H}
                        stroke={C.faint}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={0}
                        x2={W}
                        y1={y(closes[hover])}
                        y2={y(closes[hover])}
                        stroke={C.faint}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={x(hover)}
                        cy={y(closes[hover])}
                        r={3.5}
                        fill={stroke}
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  )}
                </svg>
                {openVisible && (
                  <PlotLabel yFrac={y(open) / H} xFrac={0.99} color={C.faint}>
                    open
                  </PlotLabel>
                )}
                {/* Pulsing head of the live tape */}
                <div
                  className="pointer-events-none absolute"
                  style={{
                    right: -4,
                    top: `${(y(last) / H) * 100}%`,
                    transform: "translateY(-50%)",
                    transition: "top 0.4s linear",
                  }}
                >
                  <span className="relative flex h-2 w-2">
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-[1px] opacity-70"
                      style={{ backgroundColor: stroke }}
                    />
                    <span
                      className="relative inline-flex h-2 w-2 rounded-[1px]"
                      style={{ backgroundColor: stroke }}
                    />
                  </span>
                </div>
                {hoverCandle && (
                  <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-panel/95 px-2.5 py-1.5 font-mono text-[11px] shadow-xl backdrop-blur">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-[2px] w-3 rounded-full"
                        style={{ background: stroke }}
                        aria-hidden="true"
                      />
                      <span className="tnum text-fg">
                        {money(hoverCandle.c)}
                      </span>
                    </div>
                    {showMa20 && hover != null && ma20[hover] != null && (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className="h-[2px] w-3 rounded-full"
                          style={{ background: C.accent }}
                          aria-hidden="true"
                        />
                        <span className="tnum text-dim">
                          {money(ma20[hover]!)}
                        </span>
                        <span className="text-faint">MA20</span>
                      </div>
                    )}
                    {showMa50 && hover != null && ma50[hover] != null && (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className="h-[2px] w-3 rounded-full"
                          style={{ background: C.accentHi }}
                          aria-hidden="true"
                        />
                        <span className="tnum text-dim">
                          {money(ma50[hover]!)}
                        </span>
                        <span className="text-faint">MA50</span>
                      </div>
                    )}
                    <div className="mt-0.5 text-faint">
                      {new Date(hoverCandle.t).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                )}
              </div>
              {/* Corner + X (time) axis */}
              <div />
              <div className="flex justify-between gap-1 overflow-hidden pt-1.5 font-mono text-[10px] tabular-nums text-faint">
                {xTicks.map((t, i) => (
                  <span key={i} className="shrink-0 whitespace-nowrap">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint [html.pro_&]:hidden">
        The gold line is the average of the last 20 candles — when price
        crosses it, trend strategies pay attention. Green shading means price
        is above where this window opened; red means below.
      </p>
    </section>
  );
}
