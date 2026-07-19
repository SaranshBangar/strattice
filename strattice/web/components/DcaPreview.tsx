"use client";
// Recurring-buy (DCA) simulator: fixed rupee amount, fixed schedule, real daily
// candles. Contributions vs mark-to-market value, net of per-side friction.
// PREVIEW ONLY - the engine cannot run DCA live yet (see DCA_META.warning).
import { useEffect, useMemo, useState } from "react";
import { simulateDca, type Candle, type DcaResult } from "@/lib/strategy-sim";
import { DCA_META } from "@/lib/strategies";
import { MARKETS, marketLabel } from "@/lib/coins";
import { CoinLogo } from "@/components/CoinLogo";
import { Select } from "@/components/Select";
import { Spinner } from "@/components/Spinner";
const SCHEDULES = [
  { value: "7", label: "Weekly" },
  { value: "14", label: "Every 2 weeks" },
  { value: "30", label: "Monthly" },
] as const;
const AMOUNTS = ["500", "1000", "2500", "5000"] as const;
const LIMIT = 1000; // ≈ 33 months of daily bars

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "default";
  hint?: string;
}) {
  const c =
    tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-fg";
  return (
    <div className="rounded-md bg-inset px-3 py-2" title={hint}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${c}`}
      >
        {value}
      </div>
    </div>
  );
}

export function DcaPreview() {
  const [market, setMarket] = useState(MARKETS[0]);
  const [every, setEvery] = useState<string>("7");
  const [amount, setAmount] = useState<string>("1000");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      try {
        const r = await fetch(
          `/api/candles?pair=${encodeURIComponent(market)}&interval=1d&limit=${LIMIT}`,
        );
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !Array.isArray(j.candles) || j.candles.length < 30) {
          setStatus("error");
          return;
        }
        setCandles(j.candles);
        setStatus("ok");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [market]);

  const sim: DcaResult | null = useMemo(
    () =>
      candles.length
        ? simulateDca(candles, Number(every), Number(amount))
        : null,
    [candles, every, amount],
  );

  // ----- chart: contributions (step) vs portfolio value (line) -----
  const W = 1000,
    H = 220;
  const n = candles.length;
  const chart = useMemo(() => {
    if (!sim || !n) return null;
    const hi = Math.max(...sim.values, ...sim.investedByBar, 1) * 1.05;
    const x = (i: number) => ((i + 0.5) / n) * W;
    const y = (v: number) => H - (v / hi) * H;
    const path = (vals: number[]) =>
      vals
        .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
        .join(" ");
    return {
      valuePath: path(sim.values),
      investedPath: path(sim.investedByBar),
      buys: sim.buys.map((b) => ({ cx: x(b.idx), cy: y(sim.values[b.idx]) })),
      hi,
    };
  }, [sim, n]);

  const months = n ? Math.round(n / 30.4) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          ariaLabel="Market"
          value={market}
          onChange={setMarket}
          options={MARKETS.map((m) => ({
            value: m,
            label: marketLabel(m),
            icon: <CoinLogo market={m} size={14} />,
          }))}
        />
        <Select
          size="sm"
          ariaLabel="Buy schedule"
          value={every}
          onChange={setEvery}
          options={SCHEDULES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          size="sm"
          ariaLabel="Amount per buy"
          value={amount}
          onChange={setAmount}
          options={AMOUNTS.map((a) => ({
            value: a,
            label: `${inr(Number(a))} per buy`,
          }))}
        />
        {status === "ok" && (
          <span className="font-mono text-[11px] text-faint">
            {n} daily bars · ≈ {months} months
          </span>
        )}
      </div>

      {status === "error" ? (
        <div className="grid h-[220px] place-items-center rounded-md border border-dashed border-line text-sm text-muted">
          Could not load candles for {market}.
        </div>
      ) : status === "loading" || !sim || !chart ? (
        <div className="grid h-[220px] place-items-center gap-2 rounded-md border border-dashed border-line text-sm text-faint">
          <Spinner className="h-5 w-5" />
          Simulating recurring buys…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat
              label="Contributed"
              value={inr(sim.invested)}
              hint={`${sim.buys.length} buys of ${inr(Number(amount))}`}
            />
            <Stat
              label="Value now"
              value={inr(sim.finalValue)}
              tone={sim.finalValue >= sim.invested ? "good" : "bad"}
              hint="Mark-to-market at the last close"
            />
            <Stat
              label="Net if sold"
              value={pct(sim.netIfSoldPct)}
              tone={sim.netIfSoldPct >= 0 ? "good" : "bad"}
              hint="After sell-side friction: exchange fee + GST + 1% TDS. Gains taxed at 30% (India VDA) on top."
            />
            <Stat
              label="Lump sum"
              value={pct(sim.lumpSumNetPct)}
              tone={sim.lumpSumNetPct >= 0 ? "good" : "bad"}
              hint="Everything invested on day one instead, same friction"
            />
            <Stat
              label="Max drawdown"
              value={`-${sim.maxDrawdownPct.toFixed(1)}%`}
              tone={sim.maxDrawdownPct > 25 ? "bad" : "default"}
              hint="Worst drop of value vs contributions from its peak"
            />
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            width="100%"
            style={{ height: 220, display: "block" }}
            className="rounded-md bg-inset"
            role="img"
            aria-label={`Recurring ${inr(Number(amount))} buys on ${market}: contributions versus portfolio value over ${months} months`}
          >
            <path
              d={chart.investedPath}
              fill="none"
              stroke="#5A6379"
              strokeWidth={1.25}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={chart.valuePath}
              fill="none"
              stroke="#C9A24B"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {chart.buys.map((b, i) => (
              <circle
                key={i}
                cx={b.cx}
                cy={b.cy}
                r={2}
                fill="#16B97D"
                fillOpacity={0.8}
              />
            ))}
          </svg>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: "#C9A24B" }}
              />
              portfolio value
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2"
                style={{ borderColor: "#5A6379", borderTopStyle: "dashed" }}
              />
              contributed
            </span>
            <span>
              <span className="text-gain">●</span> buy
            </span>
          </div>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-faint">
        {DCA_META.warning}
      </p>
    </div>
  );
}
