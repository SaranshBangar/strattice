"use client";
// Strategy preview: replays a template over real CoinDCX candles and draws every
// simulated entry (▲) and exit (▼) on a candlestick chart, with the indicator levels
// the template actually watches, shaded holding periods, and summary stats. This is
// what "picking a strategy" should feel like: see the behavior before you add it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuiltinTemplate } from "@/lib/entitlements";
import {
  simulate, overlays, mergedParams, EXIT_REASON_LABEL, FRICTION_PCT,
  type Candle, type SimTrade, type OverlaySeries, type SimResult,
} from "@/lib/strategy-sim";
import { simulateCustom, customOverlays, customWarmup, type CustomDef } from "@/lib/custom-strategy";
import { Select } from "@/components/Select";
import { Spinner } from "@/components/Spinner";

const C = { gain: "#16B97D", loss: "#F0584F", accent: "#C9A24B", line: "#232838", faint: "#5A6379" } as const;

// Candle interval choices for the preview window (500 bars each). Only 15m matches
// what the live engine trades — longer intervals show more history, but entries,
// exits and returns are NOT what the engine would have done. Marked in the picker.
const INTERVALS: Record<string, string> = {
  "15m": "≈ 5 days · live interval", "1h": "≈ 3 weeks", "4h": "≈ 12 weeks", "1d": "≈ 16 months",
};
const LIMIT = 500;

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: n < 10 ? 4 : 2 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function tsShort(t: number, interval: string) {
  const d = new Date(t);
  return interval === "1d" || interval === "4h"
    ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Stat({ label, value, tone = "default", hint }: {
  label: string; value: string; tone?: "good" | "bad" | "default"; hint?: string;
}) {
  const c = tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-fg";
  return (
    <div className="rounded-md border border-line bg-inset px-3 py-2" title={hint}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

export function StrategyPreview({ template, market, params, custom, onWindowResult }: {
  /** Builtin template to preview (ignored when `custom` is set). */
  template?: BuiltinTemplate;
  market: string;
  /** Entry-param overrides for the builtin template. */
  params?: Record<string, number> | null;
  /** A user-built strategy definition - takes precedence over `template`. */
  custom?: CustomDef | null;
  /** Reports the current window's candles upward (the builder compares strategies on them). */
  onWindowResult?: (interval: string, candles: Candle[]) => void;
}) {
  const [interval, setInterval_] = useState("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const pair = market.trim().toUpperCase();

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      try {
        const r = await fetch(`/api/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${LIMIT}`);
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !Array.isArray(j.candles) || j.candles.length < 10) { setStatus("error"); return; }
        setCandles(j.candles);
        setStatus("ok");
        onWindowResult?.(interval, j.candles);
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onWindowResult is a notification, not a dependency
  }, [pair, interval]);

  const sim: SimResult | null = useMemo(() => {
    if (!candles.length) return null;
    if (custom) return simulateCustom(custom, candles);
    return template ? simulate(template, candles, params) : null;
  }, [template, candles, params, custom]);
  const lines: OverlaySeries[] = useMemo(() => {
    if (!candles.length) return [];
    if (custom) return customOverlays(custom, candles);
    return template ? overlays(template, candles, params) : [];
  }, [template, candles, params, custom]);

  // Bars before the slowest indicator (usually the regime SMA) has data - marked on the chart.
  const warmup = Math.min(
    candles.length,
    custom
      ? customWarmup(custom)
      : template
        ? Math.max(...Object.values(mergedParams(template, params)).filter((v) => Number.isInteger(v) && v > 1), 2) + 1
        : 2,
  );

  // ----- chart geometry -----
  const n = candles.length;
  const W = 1000, H = 300, N = 4;
  let loRaw = Infinity, hiRaw = -Infinity;
  for (const c of candles) { loRaw = Math.min(loRaw, c.l); hiRaw = Math.max(hiRaw, c.h); }
  for (const s of lines) for (const v of s.points) if (v !== null) { loRaw = Math.min(loRaw, v); hiRaw = Math.max(hiRaw, v); }
  if (!isFinite(loRaw)) { loRaw = 0; hiRaw = 1; }
  const padV = (hiRaw - loRaw) * 0.07 || Math.abs(hiRaw) * 0.06 || 1;
  const lo = loRaw - padV, hi = hiRaw + padV, span = hi - lo || 1;
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (v: number) => ((hi - v) / span) * H;
  const xPct = (i: number) => ((i + 0.5) / n) * 100;
  const yPct = (v: number) => ((hi - v) / span) * 100;
  const slot = W / Math.max(1, n);
  const bodyW = Math.max(0.8, slot * 0.6);
  const yTicks = Array.from({ length: N + 1 }, (_, i) => hi - (i / N) * span);
  const xk = Math.min(5, n);
  const xTicks = xk <= 1
    ? candles.slice(0, 1).map((c) => tsShort(c.t, interval))
    : Array.from({ length: xk }, (_, j) => tsShort(candles[Math.round((j * (n - 1)) / (xk - 1))].t, interval));

  function linePath(points: (number | null)[]) {
    let d = "", pen = false;
    for (let i = 0; i < points.length; i++) {
      const v = points[i];
      if (v === null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  }

  function onMove(e: React.MouseEvent) {
    const el = plotRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.min(n - 1, Math.max(0, Math.round(frac * n - 0.5))));
  }

  // Trade event lookup for the hover tooltip.
  const eventAt = useMemo(() => {
    const m = new Map<number, { kind: "entry" | "exit"; trade: SimTrade }>();
    for (const t of sim?.trades ?? []) {
      m.set(t.entryIdx, { kind: "entry", trade: t });
      if (t.exitIdx !== null) m.set(t.exitIdx, { kind: "exit", trade: t });
    }
    return m;
  }, [sim]);

  const hc = hover !== null ? candles[hover] : null;
  const hoverEvent = hover !== null ? eventAt.get(hover) : undefined;
  const trades = sim?.trades ?? [];
  const last = candles.length ? candles[candles.length - 1].c : 0;

  return (
    <div className="space-y-3">
      {/* header: pair + last price + window picker */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm font-semibold text-fg">{pair.replace(/^I-/, "").replace("_", "/")}</span>
          {status === "ok" && <span className="font-mono text-sm tnum text-dim">₹{fmt(last)}</span>}
          <span className="font-mono text-[11px] text-faint">
            {status === "loading" ? "loading…" : status === "error" ? "no data" : `${n} × ${interval} bars · ${INTERVALS[interval]}`}
          </span>
        </div>
        <Select
          size="sm"
          ariaLabel="Candle interval"
          value={interval}
          onChange={setInterval_}
          options={Object.keys(INTERVALS).map((k) => ({ value: k, label: `${k} bars · ${INTERVALS[k]}` }))}
        />
      </div>

      {/* stats strip */}
      {status === "ok" && sim && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Entries" value={String(trades.length)} hint="Simulated entries in this window" />
          <Stat
            label="Win rate"
            value={sim.winRate === null ? "—" : `${sim.winRate.toFixed(0)}%`}
            tone={sim.winRate === null ? "default" : sim.winRate >= 50 ? "good" : "bad"}
            hint="Closed trades with positive net P&L"
          />
          <Stat
            label="Net return"
            value={sim.closed ? pct(sim.totalNetPct) : "—"}
            tone={sim.closed === 0 ? "default" : sim.totalNetPct >= 0 ? "good" : "bad"}
            hint={`Compounded across closed trades, after ~${FRICTION_PCT}% round-trip friction (fees + GST + TDS)`}
          />
          <Stat
            label="Buy & hold"
            value={pct(sim.buyHoldPct)}
            tone={sim.buyHoldPct >= 0 ? "good" : "bad"}
            hint="Just holding the pair over the same window"
          />
          <Stat label="Exposure" value={`${sim.exposurePct.toFixed(0)}%`} hint="Share of bars spent holding a position" />
        </div>
      )}

      {/* chart */}
      {status === "error" ? (
        <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line text-sm text-muted">
          Could not load candles for {pair}. Check the market id (e.g. I-BTC_INR).
        </div>
      ) : status === "loading" ? (
        <div className="grid h-[300px] place-items-center gap-2 rounded-md border border-dashed border-line text-sm text-faint">
          <Spinner className="h-5 w-5" />
          Simulating on live candles…
        </div>
      ) : (
        <div>
          <div className="grid" style={{ gridTemplateColumns: "4.5rem 1fr" }}>
            {/* Y axis */}
            <div className="relative" style={{ height: 300 }}>
              {yTicks.map((v, i) => (
                <span
                  key={i}
                  className="absolute right-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] leading-none tabular-nums text-faint"
                  style={{ top: `${(i / N) * 100}%` }}
                >
                  ₹{fmt(v)}
                </span>
              ))}
            </div>

            {/* plot */}
            <div
              ref={plotRef}
              className="relative"
              style={{ height: 300 }}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            >
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height: 300, display: "block" }} role="img" aria-label={`${pair} candles with simulated entries and exits`}>
                {yTicks.map((_, i) => (
                  <line key={i} x1={0} x2={W} y1={(i / N) * H} y2={(i / N) * H} stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}

                {/* holding periods, tinted by outcome */}
                {trades.map((t, i) => {
                  const x0 = (t.entryIdx / n) * W;
                  const x1 = (((t.exitIdx ?? n - 1) + 1) / n) * W;
                  const col = t.netPct >= 0 ? C.gain : C.loss;
                  return <rect key={i} x={x0} y={0} width={Math.max(1, x1 - x0)} height={H} fill={col} fillOpacity={0.07} />;
                })}

                {/* indicator warm-up boundary */}
                {warmup > 1 && warmup < n && (
                  <line x1={(warmup / n) * W} x2={(warmup / n) * W} y1={0} y2={H} stroke={C.faint} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                )}

                {/* candles */}
                {candles.map((c, i) => {
                  const up = c.c >= c.o;
                  const col = up ? C.gain : C.loss;
                  const cx = x(i);
                  const top = y(Math.max(c.o, c.c));
                  const h = Math.max(0.75, Math.abs(y(c.o) - y(c.c)));
                  return (
                    <g key={i}>
                      <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} strokeOpacity={0.85} vectorEffect="non-scaling-stroke" />
                      <rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={col} fillOpacity={0.9} />
                    </g>
                  );
                })}

                {/* indicator overlays */}
                {lines.map((s) => (
                  <path
                    key={s.name}
                    d={linePath(s.points)}
                    fill="none"
                    stroke={s.role === "primary" ? C.accent : C.faint}
                    strokeWidth={s.role === "primary" ? 1.5 : 1.25}
                    strokeDasharray={s.role === "primary" ? undefined : "5 4"}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                ))}

                {/* crosshair */}
                {hover !== null && (
                  <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke={C.faint} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                )}
              </svg>

              {/* entry / exit markers - HTML overlay so the glyphs never distort */}
              {trades.map((t, i) => (
                <div key={i} className="pointer-events-none">
                  <span
                    className="absolute -translate-x-1/2 font-mono text-[11px] leading-none text-gain"
                    style={{ left: `${xPct(t.entryIdx)}%`, top: `calc(${yPct(candles[t.entryIdx].l)}% + 4px)` }}
                    aria-label={`Entry at ₹${fmt(t.entryPrice)}`}
                  >
                    ▲
                  </span>
                  {t.exitIdx !== null && (
                    <span
                      className="absolute -translate-x-1/2 -translate-y-full font-mono text-[11px] leading-none text-loss"
                      style={{ left: `${xPct(t.exitIdx)}%`, top: `calc(${yPct(candles[t.exitIdx].h)}% - 4px)` }}
                      aria-label={`Exit at ₹${fmt(t.exitPrice)} (${EXIT_REASON_LABEL[t.reason]})`}
                    >
                      ▼
                    </span>
                  )}
                </div>
              ))}

              {/* warm-up label */}
              {warmup > 8 && warmup < n && (
                <span className="pointer-events-none absolute bottom-1 font-mono text-[9px] uppercase tracking-wider text-faint" style={{ left: 4 }}>
                  indicators warming up →
                </span>
              )}

              {/* hover tooltip */}
              {hc && (
                <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-line bg-bg/95 px-2.5 py-1.5 font-mono text-[11px] shadow-lg">
                  <div className="text-faint">{new Date(hc.t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: interval === "1d" ? undefined : "short" })}</div>
                  <div className="mt-0.5 tnum text-dim">
                    O {fmt(hc.o)} · H {fmt(hc.h)} · L {fmt(hc.l)} · C <span className="text-fg">{fmt(hc.c)}</span>
                  </div>
                  {hoverEvent && (
                    <div className={`mt-1 border-t border-line pt-1 ${hoverEvent.kind === "entry" ? "text-gain" : "text-loss"}`}>
                      {hoverEvent.kind === "entry"
                        ? `▲ entry @ ₹${fmt(hoverEvent.trade.entryPrice)}`
                        : `▼ exit (${EXIT_REASON_LABEL[hoverEvent.trade.reason]}) @ ₹${fmt(hoverEvent.trade.exitPrice)} · net ${pct(hoverEvent.trade.netPct)}`}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* corner + X axis */}
            <div />
            <div className="flex justify-between gap-1 overflow-hidden pt-1.5 font-mono text-[10px] tabular-nums text-faint">
              {xTicks.map((t, i) => (
                <span key={i} className="shrink-0 whitespace-nowrap">{t}</span>
              ))}
            </div>
          </div>

          {/* legend */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span><span className="text-gain">▲</span> entry</span>
            <span><span className="text-loss">▼</span> exit</span>
            {lines.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0 w-4 border-t-2"
                  style={{ borderColor: s.role === "primary" ? C.accent : C.faint, borderTopStyle: s.role === "primary" ? "solid" : "dashed" }}
                />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* simulated trade log */}
      {status === "ok" && (
        trades.length ? (
          <div className="overflow-hidden rounded-md border border-line">
            <div className="max-h-44 overflow-y-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="sticky top-0 bg-inset text-faint">
                  <tr>
                    <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Entry</th>
                    <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Exit</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Held</th>
                    <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Via</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {[...trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-dim">
                        <span className="text-gain">▲</span> {tsShort(candles[t.entryIdx].t, interval)} · ₹{fmt(t.entryPrice)}
                      </td>
                      <td className="px-3 py-1.5 text-dim">
                        {t.exitIdx !== null ? (
                          <><span className="text-loss">▼</span> {tsShort(candles[t.exitIdx].t, interval)} · ₹{fmt(t.exitPrice)}</>
                        ) : (
                          <span className="text-faint">still open</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tnum text-muted">{(t.exitIdx ?? n - 1) - t.entryIdx} bars</td>
                      <td className="px-3 py-1.5 text-muted">{EXIT_REASON_LABEL[t.reason]}</td>
                      <td className={`px-3 py-1.5 text-right tnum ${t.netPct >= 0 ? "text-gain" : "text-loss"}`}>{pct(t.netPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-muted">
            No entries in this window - the stock parameters are deliberately picky (regime gate, confirmation, cost gate).
            Try a longer candle interval or another market.
          </p>
        )
      )}

      <p className="text-[11px] leading-relaxed text-faint">
        Simulated preview on public CoinDCX candles: fills at bar close, long-only, net of ~{FRICTION_PCT}% round-trip
        friction (exchange fee + GST + TDS). The live engine trades 15m bars - other intervals are for exploring
        behavior, and results change with bar size. Not a promise of future returns; the live engine also enforces
        daily-loss limits and trade caps.
      </p>
    </div>
  );
}
