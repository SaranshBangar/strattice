"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Filler,
  Tooltip,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(LineElement, BarElement, PointElement, LinearScale, TimeScale, CategoryScale, Filler, Tooltip);

type Candle = { open: number; high: number; low: number; close: number; time: number };

const PAIRS = ["I-BTC_INR", "I-ETH_INR", "I-XRP_INR", "I-BNB_INR", "I-SOL_INR", "I-DOGE_INR", "I-ADA_INR"];
const INTERVALS = ["15m", "1h", "1d"];
const CHART_TYPES = ["Area", "Line", "Bar"] as const;
type ChartType = (typeof CHART_TYPES)[number];
const label = (p: string) => p.replace("I-", "").replace("_INR", "");

// CoinDCX candle ts may be seconds or ms — normalize, then format for axis/tooltip.
const asDate = (t: number) => new Date(t < 1e12 ? t * 1000 : t);
const IST = "Asia/Kolkata";
const axisLabel = (t: number, interval: string) => {
  const d = asDate(t);
  return interval === "1d"
    ? d.toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short" })
    : d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
};
const fullLabel = (t: number) =>
  asDate(t).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function MarketChart() {
  const [pair, setPair] = useState(PAIRS[0]);
  const [interval, setInterval] = useState("1h");
  const [ctype, setCtype] = useState<ChartType>("Area");
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
  const color = up ? "#16B97D" : "#F0584F";
  const last = data.at(-1)?.close;
  const chgPct =
    data.length > 1 ? ((data.at(-1)!.close - data[0].close) / data[0].close) * 100 : 0;

  const chart = useMemo(
    () => ({
      labels: data.map((c) => axisLabel(c.time, interval)),
      datasets: [
        {
          data: data.map((c) => c.close),
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 24,        // big touch target for mobile taps
          pointHoverBackgroundColor: color,
          tension: 0.25,
          fill: ctype !== "Line",
          // flat translucent fill — no gradient, reads like a terminal area plot
          backgroundColor: up ? "rgba(22,185,125,.12)" : "rgba(240,88,79,.12)",
        },
      ],
    }),
    [data, color, up, interval, ctype]
  );

  const Plot = ctype === "Bar" ? Bar : Line;

  return (
    <div className="card">
      <div className="chart-head">
        <select className="sel" value={pair} onChange={(e) => setPair(e.target.value)}>
          {PAIRS.map((p) => (
            <option key={p} value={p}>{label(p)}</option>
          ))}
        </select>
        <select className="sel" value={ctype} onChange={(e) => setCtype(e.target.value as ChartType)}>
          {CHART_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
          {last ? `₹${last.toLocaleString("en-IN")}` : "—"}
        </span>
        <span className={up ? "green" : "red"} style={{ fontWeight: 600 }}>
          {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
        </span>
      </div>
      <div style={{ height: "min(50vh, 320px)" }}>
        {loading ? (
          <p className="center muted">loading…</p>
        ) : data.length === 0 ? (
          <p className="center muted">no data</p>
        ) : (
          <Plot
            data={chart as any}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: { duration: 350, easing: "easeOutQuart" },
              // index + intersect:false => hover OR tap anywhere on x shows the point
              interaction: { mode: "index", intersect: false },
              plugins: {
                legend: { display: false },
                tooltip: {
                  enabled: true,
                  displayColors: false,
                  padding: 8,
                  callbacks: {
                    title: (items: any) => fullLabel(data[items[0].dataIndex].time),
                    label: (item: any) => "₹" + item.parsed.y.toLocaleString("en-IN"),
                  },
                },
              },
              scales: {
                x: {
                  type: "category",
                  grid: { display: false },
                  ticks: { color: "#828AA0", maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 10 } },
                },
                y: {
                  position: "right",
                  grid: { color: "#232838" },
                  ticks: {
                    color: "#828AA0",
                    maxTicksLimit: 5,
                    font: { size: 10 },
                    callback: (v: any) => "₹" + Number(v).toLocaleString("en-IN"),
                  },
                },
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
