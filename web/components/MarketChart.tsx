"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Filler, Tooltip);

type Candle = { open: number; high: number; low: number; close: number; time: number };

const PAIRS = ["I-BTC_INR", "I-ETH_INR", "I-XRP_INR", "I-BNB_INR"];
const INTERVALS = ["15m", "1h", "1d"];

export default function MarketChart() {
  const [pair, setPair] = useState(PAIRS[0]);
  const [interval, setInterval] = useState("1h");
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/candles?pair=${pair}&interval=${interval}&limit=120`)
      .then((r) => r.json())
      .then((d: Candle[]) => {
        if (!live) return;
        setData(Array.isArray(d) ? [...d].sort((a, b) => a.time - b.time) : []);
        setLoading(false);
      })
      .catch(() => live && setLoading(false));
    return () => { live = false; };
  }, [pair, interval]);

  const up = data.length > 1 && data[data.length - 1].close >= data[0].close;
  const color = up ? "#2ecc71" : "#ff5d5d";
  const last = data.at(-1)?.close;
  const chgPct =
    data.length > 1 ? ((data.at(-1)!.close - data[0].close) / data[0].close) * 100 : 0;

  const chart = useMemo(
    () => ({
      labels: data.map((c) => c.time),
      datasets: [
        {
          data: data.map((c) => c.close),
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true,
          backgroundColor: (ctx: any) => {
            const { ctx: c, chartArea } = ctx.chart;
            if (!chartArea) return "transparent";
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, up ? "rgba(46,204,113,.25)" : "rgba(255,93,93,.25)");
            g.addColorStop(1, "transparent");
            return g;
          },
        },
      ],
    }),
    [data, color, up]
  );

  return (
    <div className="card">
      <div className="tabs">
        {PAIRS.map((p) => (
          <button key={p} className={`tab ${p === pair ? "active" : ""}`} onClick={() => setPair(p)}>
            {p.replace("I-", "").replace("_INR", "")}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
          {last ? `₹${last.toLocaleString("en-IN")}` : "—"}
        </span>
        <span className={up ? "green" : "red"} style={{ fontWeight: 600 }}>
          {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
        </span>
      </div>
      <div style={{ height: 200 }}>
        {loading ? (
          <p className="center muted">loading…</p>
        ) : (
          <Line
            data={chart}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              plugins: { tooltip: { enabled: true }, legend: { display: false } },
              scales: {
                x: { display: false, type: "category" },
                y: { position: "right", grid: { color: "#232a38" }, ticks: { color: "#8b93a7", maxTicksLimit: 5 } },
              },
            }}
          />
        )}
      </div>
      <div className="tabs" style={{ marginTop: 10, marginBottom: 0 }}>
        {INTERVALS.map((iv) => (
          <button key={iv} className={`tab ${iv === interval ? "active" : ""}`} onClick={() => setInterval(iv)}>
            {iv}
          </button>
        ))}
      </div>
    </div>
  );
}
