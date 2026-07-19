"use client";
// Landing-page live tape. Streams real trades from Binance WebSocket (free,
// no key, no rate-limit pain) and appends to a rolling window every 500ms.
// Seeded from Binance 1s klines so the line is full on first paint.
// Rendering is the fixed-axis LiveTape engine: still gridlines and tick
// labels, a gold 20-tick average, a dashed "open" reference and a green/red
// wash for time spent above/below it.
// Display-only: the bot itself still trades INR pairs on CoinDCX.
import { useEffect, useState } from "react";
import { LiveTape, type LiveTapePoint } from "@/components/chart/LiveTape";
import { useBinanceTradeStream } from "@/components/chart/useBinanceTradeStream";
import { C } from "@/components/chart/primitives";
import { CoinLogo } from "@/components/CoinLogo";
import { useAutoFx } from "@/lib/geo-currency";

const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "DOGEUSDT",
] as const;
type Symbol = (typeof SYMBOLS)[number];

const WINDOW_MS = 60_000; // visible span
const TICK_MS = 500; // append cadence
// Buffer: one window on screen + slack so the SMA is warm at the left edge.
// Prune rarely (in chunks) - each prune shifts the tape's time epoch, which
// briefly suspends the scroll transition for one frame.
const KEEP = 200;
const CAP = 240;
const H = 280;

export function LiveChart() {
  // Binance quotes are USD; localize the displayed price to the visitor's
  // currency once detection resolves (defaults to USD before then).
  const fx = useAutoFx();
  const sym = fx.ready ? fx.symbol : "$";
  const rate = fx.ready ? fx.usdRate : 1;
  const loc = fx.ready ? fx.locale : "en-US";
  const price = (n: number) => {
    const v = n * rate;
    return `${sym}${v.toLocaleString(loc, {
      minimumFractionDigits: 2,
      maximumFractionDigits: v < 10 ? 4 : 2,
    })}`;
  };

  const [symbol, setSymbol] = useState<Symbol>("BTCUSDT");
  const [points, setPoints] = useState<LiveTapePoint[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  // WS lifecycle (backoff reconnects + staleness) lives in the shared hook.
  const { priceRef, stale } = useBinanceTradeStream(symbol);

  useEffect(() => {
    let alive = true;
    setPoints([]);
    setOpen(null);

    // Seed the window with real 1-second closes so the line is instantly full.
    fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1s&limit=${KEEP}`,
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
          priceRef.current = seeded[seeded.length - 1].v;
          setPoints(seeded);
          setOpen(seeded[seeded.length - 1].v);
        }
      })
      .catch(() => {});

    // The march: fold the latest traded price into the window on a fixed beat,
    // so the line visibly moves even between trades.
    const id = window.setInterval(() => {
      const p = priceRef.current;
      if (p == null) return;
      // If the kline seed failed (offline API), anchor "open" on the
      // first streamed trade instead.
      setOpen((o) => o ?? p);
      setPoints((prev) => {
        const next = [...prev, { t: Date.now(), v: p }];
        return next.length > CAP ? next.slice(next.length - KEEP) : next;
      });
    }, TICK_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- priceRef is a stable ref from the stream hook
  }, [symbol]);

  const n = points.length;
  const last = n ? points[n - 1].v : 0;
  const prev = n > 1 ? points[n - 2].v : last;
  // Direction + % change measured across the visible window, not the buffer.
  const cutoff = n ? points[n - 1].t - WINDOW_MS : 0;
  const firstVisible = points.find((p) => p.t >= cutoff)?.v ?? points[0]?.v;
  const dir = last > prev ? 1 : last < prev ? -1 : 0;
  const up = n > 1 && firstVisible != null && last >= firstVisible;
  const stroke = up ? C.gain : C.loss;
  const change = firstVisible ? ((last - firstVisible) / firstVisible) * 100 : 0;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          {stale ? (
            <span
              className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent"
              role="status"
            >
              <span className="relative inline-flex h-2 w-2 rounded-[1px] bg-accent" />
              stale · reconnecting
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gain">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-[1px] bg-gain opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-[1px] bg-gain" />
              </span>
              live
            </span>
          )}
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight text-dim">
            <CoinLogo market={symbol} size={16} />
            {symbol.replace("USDT", "/USDT")}
          </h3>
          {n > 1 && (
            <>
              <span
                className="font-mono text-lg font-semibold tnum transition-colors duration-300"
                style={{
                  color: dir > 0 ? C.gain : dir < 0 ? C.loss : undefined,
                }}
              >
                {price(last)}
              </span>
              <span
                className="font-mono text-xs tnum"
                style={{ color: stroke }}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(3)}%
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                s === symbol
                  ? "bg-white/[0.06] text-fg"
                  : "text-faint hover:text-muted"
              }`}
            >
              <CoinLogo market={s} size={14} />
              {s.replace("USDT", "")}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-3">
        {n < 2 ? (
          <div
            className="grid place-items-center font-mono text-[11px] text-faint"
            style={{ height: H }}
          >
            {stale
              ? "market data unreachable — retrying in the background"
              : "connecting to live tape…"}
          </div>
        ) : (
          <LiveTape
            points={points}
            windowMs={WINDOW_MS}
            tickMs={TICK_MS}
            height={H}
            fmtY={(v) => price(v)}
            overlays={[
              {
                id: "sma20",
                label: "20-tick avg",
                period: 20,
                kind: "sma",
                color: C.accent,
              },
            ]}
            baseline={open}
            domainKey={symbol}
            ariaLabel={`${symbol} live price, last 60 seconds`}
          />
        )}
      </div>

      <div className="flex flex-col gap-1 bg-white/[0.03] px-4 py-2 font-mono text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>strategies act on lines like the gold average</span>
        <span className="shrink-0">
          Binance stream · display only, bots trade on CoinDCX
        </span>
      </div>
    </section>
  );
}
