"use client";
// Live market price chart. Polls /api/candles, draws an area line with a hover
// crosshair + readout. Pair/interval selectable. Refreshes on an interval.
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/Select";

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

const DEFAULT_MARKETS = ["I-BTC_INR", "I-ETH_INR", "I-SOL_INR", "I-XRP_INR", "I-DOGE_INR", "I-BNB_INR"];
const INTERVALS = ["5m", "15m", "1h", "4h", "1d"];
const POLL_MS = 20000;

function label(pair: string) {
  return pair.replace(/^I-/, "").replace("_", "/");
}
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: n < 10 ? 4 : 2 });

export function PriceChart({ markets }: { markets?: string[] }) {
  const pairs = useMemo(() => Array.from(new Set([...(markets ?? []), ...DEFAULT_MARKETS])), [markets]);
  const [pair, setPair] = useState(pairs[0] ?? "I-BTC_INR");
  const [interval, setInterval_] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    async function load(initial: boolean) {
      if (initial) setStatus("loading");
      try {
        const r = await fetch(`/api/candles?pair=${pair}&interval=${interval}&limit=200`);
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !Array.isArray(j.candles)) { setStatus("error"); return; }
        setCandles(j.candles);
        setStatus("ok");
      } catch {
        if (alive) setStatus("error");
      }
    }
    load(true);
    const id = window.setInterval(() => load(false), POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [pair, interval]);

  const closes = candles.map((c) => c.c);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = first ? ((last - first) / first) * 100 : 0;
  const up = change >= 0;
  const stroke = up ? "#16B97D" : "#F0584F";

  const W = 1000, H = 260, padY = 12;
  const lo = closes.length ? Math.min(...closes) : 0;
  const hi = closes.length ? Math.max(...closes) : 1;
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - padY * 2);
  const path = closes.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = closes.length ? `${path} L${W} ${H} L0 ${H} Z` : "";

  function onMove(e: React.MouseEvent) {
    const el = svgRef.current;
    if (!el || closes.length < 2) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (closes.length - 1)));
  }

  const hoverCandle = hover != null ? candles[hover] : null;

  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-sm font-semibold tracking-tight text-dim">{label(pair)}</h3>
            {status === "ok" && (
              <>
                <span className="font-mono text-lg font-semibold tnum text-fg">₹{fmt(last)}</span>
                <span className={["font-mono text-xs tnum", up ? "text-gain" : "text-loss"].join(" ")}>
                  {up ? "+" : ""}{change.toFixed(2)}%
                </span>
              </>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-faint">
            {status === "loading" ? "loading…" : status === "error" ? "market data unavailable" : `${interval} · live from CoinDCX`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select size="sm" ariaLabel="Market" value={pair} onChange={setPair} options={pairs.map((p) => ({ value: p, label: label(p) }))} />
          <Select size="sm" ariaLabel="Interval" value={interval} onChange={setInterval_} options={INTERVALS.map((i) => ({ value: i, label: i }))} />
        </div>
      </div>

      <div className="relative p-3" ref={svgRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {status === "error" ? (
          <div className="grid h-[260px] place-items-center text-sm text-muted">Could not load market data. Retrying…</div>
        ) : closes.length < 2 ? (
          <div className="grid h-[260px] place-items-center text-sm text-faint">Loading candles…</div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height: 260, display: "block" }} role="img" aria-label={`${label(pair)} price`}>
              <path d={area} fill={stroke} fillOpacity={0.07} />
              <path d={path} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              {hover != null && (
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="#5A6379" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              )}
              {hover != null && <circle cx={x(hover)} cy={y(closes[hover])} r={3.5} fill={stroke} vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="pointer-events-none absolute right-4 top-3 font-mono text-[10px] text-faint">₹{fmt(hi)}</span>
            <span className="pointer-events-none absolute bottom-3 right-4 font-mono text-[10px] text-faint">₹{fmt(lo)}</span>
            {hoverCandle && (
              <div className="pointer-events-none absolute left-4 top-3 rounded-md border border-line bg-bg/95 px-2.5 py-1.5 font-mono text-[11px] shadow-lg">
                <div className="tnum text-fg">₹{fmt(hoverCandle.c)}</div>
                <div className="mt-0.5 text-faint">{new Date(hoverCandle.t).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
