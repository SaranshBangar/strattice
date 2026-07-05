"use client";
// Live market price chart. Seeds from /api/candles (Binance klines), then
// streams real trades over Binance WebSocket to tick the last candle in real
// time. Area line with x/y axes, hover crosshair + readout. Pair/interval
// selectable. Poll stays as slow backfill for closed candles.
import { useEffect, useMemo, useRef, useState } from "react";
import { toBinanceSymbol } from "@/lib/binance";
import { Select } from "@/components/Select";
import { Delta } from "@/components/Delta";
import { Spinner } from "@/components/Spinner";

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
const RANGES = Object.keys(WINDOWS);
const POLL_MS = 20000;

function label(pair: string) {
  return pair.replace(/^I-/, "").replace("_", "/");
}
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });

export function PriceChart({ markets }: { markets?: string[] }) {
  const pairs = useMemo(
    () => Array.from(new Set([...(markets ?? []), ...DEFAULT_MARKETS])),
    [markets],
  );
  const [pair, setPair] = useState(pairs[0] ?? "I-BTC_INR");
  const [range, setRange] = useState("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
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
    const id = window.setInterval(() => load(false), POLL_MS);

    // Live tick: stream real trades, fold the latest price into the current
    // candle a few times a second so the chart moves between polls.
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
    connect();
    const tick = window.setInterval(() => {
      const p = liveRef.price;
      if (p == null) return;
      liveRef.price = null;
      setCandles((prev) => {
        if (!prev.length) return prev;
        const lastC = prev[prev.length - 1];
        if (p === lastC.c) return prev;
        return [
          ...prev.slice(0, -1),
          { ...lastC, c: p, h: Math.max(lastC.h, p), l: Math.min(lastC.l, p) },
        ];
      });
    }, 400);

    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearInterval(tick);
      window.clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [pair, range]);

  const closes = candles.map((c) => c.c);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = first ? ((last - first) / first) * 100 : 0;
  const up = change >= 0;
  const stroke = up ? "#16B97D" : "#F0584F";

  const W = 1000,
    H = 260,
    N = 4;
  const loRaw = closes.length ? Math.min(...closes) : 0;
  const hiRaw = closes.length ? Math.max(...closes) : 1;
  // Pad the domain ~6% so ticks/gridlines frame the line instead of clipping it.
  const padV = (hiRaw - loRaw) * 0.06 || Math.abs(hiRaw) * 0.06 || 1;
  const lo = loRaw - padV;
  const hi = hiRaw + padV;
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => ((hi - v) / span) * H;
  const path = closes
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
    )
    .join(" ");
  const area = closes.length ? `${path} L${W} ${H} L0 ${H} Z` : "";
  const yTicks = Array.from(
    { length: N + 1 },
    (_, i) => hi - (i / N) * (hi - lo),
  );
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

  return (
    <section className="card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
              {label(pair)}
            </h3>
            {status === "ok" && (
              <>
                <span className="font-mono text-lg font-semibold tnum text-fg">
                  ${fmt(last)}
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
                : `last ${range} · streaming live from Binance`}
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="p-3">
        {status === "error" ? (
          <div className="grid h-[260px] place-items-center text-sm text-muted">
            Could not load market data. Retrying…
          </div>
        ) : closes.length < 2 ? (
          <div className="grid h-[260px] place-items-center gap-2 text-sm text-faint">
            <Spinner className="h-5 w-5" />
            Loading candles…
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "4.5rem 1fr" }}>
            {/* Y (price) axis */}
            <div className="relative" style={{ height: 260 }}>
              {yTicks.map((v, i) => (
                <span
                  key={i}
                  className="absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] leading-none tabular-nums text-faint"
                  style={{ top: `${(i / N) * 100}%` }}
                >
                  ${fmt(v)}
                </span>
              ))}
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
                {yTicks.map((_, i) => {
                  const gy = (i / N) * H;
                  return (
                    <line
                      key={i}
                      x1={0}
                      x2={W}
                      y1={gy}
                      y2={gy}
                      stroke="#232838"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {/* Vertical guidelines aligned with the time-axis ticks */}
                {xTickIdx.map((idx, i) => (
                  <line
                    key={`vx${i}`}
                    x1={x(idx)}
                    x2={x(idx)}
                    y1={0}
                    y2={H}
                    stroke="#232838"
                    strokeWidth={1}
                    strokeDasharray="2 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {/* Axis frame: y-axis on the left, x-axis on the bottom */}
                <line
                  x1={0}
                  x2={0}
                  y1={0}
                  y2={H}
                  stroke="#39415A"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={0}
                  x2={W}
                  y1={H}
                  y2={H}
                  stroke="#39415A"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <path d={area} fill={stroke} fillOpacity={0.07} />
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
                  <line
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={0}
                    y2={H}
                    stroke="#5A6379"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {hover != null && (
                  <circle
                    cx={x(hover)}
                    cy={y(closes[hover])}
                    r={3.5}
                    fill={stroke}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
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
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                    style={{ backgroundColor: stroke }}
                  />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ backgroundColor: stroke }}
                  />
                </span>
              </div>
              {hoverCandle && (
                <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-panel/95 px-2.5 py-1.5 font-mono text-[11px] shadow-xl backdrop-blur">
                  <div className="tnum text-fg">${fmt(hoverCandle.c)}</div>
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
        )}
      </div>
    </section>
  );
}
