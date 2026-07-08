"use client";
// Shared Binance trade-stream hook for the live tapes (LiveChart, PriceChart).
// Owns the WebSocket lifecycle: connect, parse trades into a ref (no re-render
// per tick - consumers sample on their own cadence), reconnect with exponential
// backoff + jitter (2s -> 4s -> 8s -> 16s -> 30s cap, reset on the first
// message), and a reactive `stale` flag when no trade has arrived for a while -
// so a frozen tape can say so instead of quietly flatlining.
import { useEffect, useRef, useState } from "react";

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
/** No message for this long = the tape is stale (WS dead or market halted). */
const STALE_MS = 10_000;
const STALE_CHECK_MS = 2_000;

export function useBinanceTradeStream(symbol: string | null | undefined) {
  const priceRef = useRef<number | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    priceRef.current = null;
    setStale(false);
    if (!symbol) return;

    let alive = true;
    let ws: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let lastMsgAt = Date.now(); // treat "just mounted" as fresh

    function connect() {
      if (!alive) return;
      try {
        ws = new WebSocket(
          `wss://stream.binance.com:9443/ws/${symbol!.toLowerCase()}@trade`,
        );
      } catch {
        scheduleRetry();
        return;
      }
      ws.onmessage = (e) => {
        try {
          const p = Number(JSON.parse(e.data as string).p);
          if (Number.isFinite(p)) {
            priceRef.current = p;
            lastMsgAt = Date.now();
            attempt = 0; // healthy again - future retries start fast
          }
        } catch {}
      };
      // onerror is always followed by onclose; reconnect from one place only.
      ws.onclose = () => {
        if (alive) scheduleRetry();
      };
    }

    function scheduleRetry() {
      const backoff = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt);
      attempt = Math.min(attempt + 1, 6);
      const jitter = backoff * 0.25 * Math.random();
      retryTimer = window.setTimeout(connect, backoff + jitter);
    }

    connect();

    const staleTimer = window.setInterval(
      () => setStale(Date.now() - lastMsgAt > STALE_MS),
      STALE_CHECK_MS,
    );

    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      window.clearInterval(staleTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [symbol]);

  return { priceRef, stale };
}
