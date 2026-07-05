"use client";
// Landing-page live tape. Streams real trades from Binance WebSocket (free,
// no key, no rate-limit pain) and marches a rolling ~60s line every 500ms.
// Seeded from Binance 1s klines so the line is full on first paint.
// Display-only: the bot itself still trades INR pairs on CoinDCX.
import { useEffect, useMemo, useRef, useState } from "react";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
type Symbol = (typeof SYMBOLS)[number];

const POINTS = 120; // rolling window size
const TICK_MS = 500; // append cadence -> POINTS * TICK_MS = 60s on screen
const W = 1000;
const H = 220;

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 10 ? 4 : 2,
  });

export function LiveChart() {
  const [symbol, setSymbol] = useState<Symbol>("BTCUSDT");
  const [points, setPoints] = useState<number[]>([]);
  const priceRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    setPoints([]);
    priceRef.current = null;

    // Seed the window with real 1-second closes so the line is instantly full.
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1s&limit=${POINTS}`,
    )
      .then((r) => r.json())
      .then((rows: unknown) => {
        if (!alive || !Array.isArray(rows)) return;
        const closes = rows
          .map((row) => Number((row as string[])[4]))
          .filter(Number.isFinite);
        if (closes.length) {
          priceRef.current = closes[closes.length - 1];
          setPoints(closes);
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
          if (Number.isFinite(p)) priceRef.current = p;
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
      setPoints((prev) => [...prev.slice(-(POINTS - 1)), p]);
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
  const last = points[n - 1];
  const prev = points[n - 2];
  const first = points[0];
  const dir = last > prev ? 1 : last < prev ? -1 : 0;
  const up = n > 1 && last >= first;
  const stroke = up ? "#16B97D" : "#F0584F";
  const change = first ? ((last - first) / first) * 100 : 0;

  const { path, area, endX, endY } = useMemo(() => {
    if (n < 2) return { path: "", area: "", endX: 0, endY: 0 };
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.001 || 1;
    const span = hi - lo + pad * 2;
    const x = (i: number) => (i / (POINTS - 1)) * W;
    const y = (v: number) => ((hi + pad - v) / span) * H;
    // Right-align a partially filled window so the line grows in from the right.
    const off = POINTS - n;
    const d = points
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${x(off + i).toFixed(1)} ${y(v).toFixed(1)}`,
      )
      .join(" ");
    return {
      path: d,
      area: `${d} L${W} ${H} L${x(off)} ${H} Z`,
      endX: 100,
      endY: (y(points[n - 1]) / H) * 100,
    };
  }, [points, n]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gain">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gain" />
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
                  color: dir > 0 ? "#16B97D" : dir < 0 ? "#F0584F" : undefined,
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

      <div className="relative px-3 pb-3" style={{ height: H }}>
        {n < 2 ? (
          <div className="grid h-full place-items-center font-mono text-[11px] text-faint">
            connecting to live tape…
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              style={{ display: "block" }}
              role="img"
              aria-label={`${symbol} live price, last 60 seconds`}
            >
              <defs>
                <linearGradient id="livefill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#livefill)" />
              <path
                d={path}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            {/* Pulsing head of the tape, in HTML so animate-ping just works */}
            <div
              className="pointer-events-none absolute"
              style={{
                left: `calc(${endX}% - 4px)`,
                top: `${endY}%`,
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
          </>
        )}
      </div>

      <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2 font-mono text-[11px] text-faint">
        <span>last 60 seconds · tick every trade</span>
        <span>Binance public stream · display only, bots trade on CoinDCX</span>
      </div>
    </section>
  );
}
