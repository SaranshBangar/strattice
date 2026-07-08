"use client";
// Landing-page live tape. Streams real trades from Binance WebSocket (free,
// no key, no rate-limit pain) and appends to a rolling window every 500ms.
// Seeded from Binance 1s klines so the line is full on first paint.
// Rendering is the fixed-axis LiveTape engine: still gridlines and tick
// labels, a gold 20-tick average, a dashed "open" reference and a green/red
// wash for time spent above/below it.
// Display-only: the bot itself still trades INR pairs on CoinDCX.
import { useEffect, useRef, useState } from "react";
import { LiveTape, type LiveTapePoint } from "@/components/chart/LiveTape";
import { C } from "@/components/chart/primitives";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
type Symbol = (typeof SYMBOLS)[number];

const WINDOW_MS = 60_000; // visible span
const TICK_MS = 500; // append cadence
// Buffer: one window on screen + slack so the SMA is warm at the left edge.
// Prune rarely (in chunks) - each prune shifts the tape's time epoch, which
// briefly suspends the scroll transition for one frame.
const KEEP = 200;
const CAP = 240;
const H = 220;

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 10 ? 4 : 2,
  });

export function LiveChart() {
  const [symbol, setSymbol] = useState<Symbol>("BTCUSDT");
  const [points, setPoints] = useState<LiveTapePoint[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const priceRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    setPoints([]);
    setOpen(null);
    priceRef.current = null;

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

    function connect() {
      ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`,
      );
      ws.onmessage = (e) => {
        try {
          const p = Number(JSON.parse(e.data as string).p);
          if (Number.isFinite(p)) {
            priceRef.current = p;
            // If the kline seed failed (offline API), anchor "open" on the
            // first streamed trade instead.
            setOpen((o) => o ?? p);
          }
        } catch {}
      };
      ws.onclose = () => {
        if (alive) retry = window.setTimeout(connect, 2000);
      };
    }
    connect();

    // The march: fold the latest traded price into the window on a fixed beat,
    // so the line visibly moves even between trades.
    const id = window.setInterval(() => {
      const p = priceRef.current;
      if (p == null) return;
      setPoints((prev) => {
        const next = [...prev, { t: Date.now(), v: p }];
        return next.length > CAP ? next.slice(next.length - KEEP) : next;
      });
    }, TICK_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
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
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gain">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-[1px] bg-gain opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-[1px] bg-gain" />
            </span>
            live
          </span>
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
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
                ${fmt(last)}
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
        <div className="flex items-center gap-1">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                s === symbol
                  ? "bg-white/[0.06] text-fg"
                  : "text-faint hover:text-muted"
              }`}
            >
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
            connecting to live tape…
          </div>
        ) : (
          <LiveTape
            points={points}
            windowMs={WINDOW_MS}
            tickMs={TICK_MS}
            height={H}
            fmtY={(v) => `$${fmt(v)}`}
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
        <span>
          strategies watch lines like the gold average — price crossing it is
          the kind of signal a bot acts on
        </span>
        <span className="shrink-0">
          Binance public stream · display only, bots trade on CoinDCX
        </span>
      </div>
    </section>
  );
}
