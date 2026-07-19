"use client";
// "Compare the strategies" - for users who don't know which template/coin to pick.
// Backtests every ACTIVE template against every coin over a user-chosen time range
// (live Binance DAILY candles, the interval the engine actually trades), ranks the
// combos on net-of-fees performance, then lets the user check off any number of
// winners and add them all in one go.
import { useState, useTransition } from "react";
import { ACTIVE_TEMPLATES, type ActiveTemplate } from "@/lib/entitlements";
import { STRATEGY_META } from "@/lib/strategies";
import { simulate, FRICTION_PCT, type Candle } from "@/lib/strategy-sim";
import { addStrategiesAction } from "@/app/actions";
import { marketLabel } from "@/lib/coins";
import { CoinLogo } from "@/components/CoinLogo";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const LIMIT = 1000; // Binance max daily bars (~2.7 years)
const MIN_CLOSED = 3; // fewer closed trades than this = not enough evidence
// Backtest lookbacks in the standard timeline vocabulary (3M/6M/1Y/2Y/MAX).
const RANGES = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "MAX (~2.7Y)", days: LIMIT },
] as const;

interface Row {
  key: string; // `${template}|${market}`
  template: ActiveTemplate;
  market: string;
  net: number; // net % after friction, over the chosen range
  closed: number;
  winRate: number | null;
  buyHold: number; // hold the coin over the same range, for comparison
  eligible: boolean;
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function BestStrategyFinder({
  markets,
  disabled,
}: {
  markets: string[];
  disabled?: boolean;
}) {
  const [days, setDays] = useState<number>(730);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ranDays, setRanDays] = useState<number>(730);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, startAdd] = useTransition();
  const toast = useToast();

  async function run() {
    setBusy(true);
    setErr(null);
    setRows(null);
    setSel(new Set());
    try {
      // One fetch per coin (parallel), sliced to the chosen range.
      const per = await Promise.all(
        markets.map(async (m) => {
          const r = await fetch(
            `/api/candles?pair=${encodeURIComponent(m)}&interval=1d&limit=${LIMIT}`,
          );
          const j = await r.json().catch(() => ({}));
          const all = Array.isArray(j.candles) ? (j.candles as Candle[]) : [];
          return { market: m, candles: all.slice(-days) };
        }),
      );
      const out: Row[] = [];
      for (const { market, candles } of per) {
        if (candles.length < 30) continue; // not enough data for this coin/range
        const buyHold =
          candles.length > 1
            ? ((candles[candles.length - 1].c - candles[0].c) / candles[0].c) *
              100
            : 0;
        for (const t of ACTIVE_TEMPLATES) {
          const s = simulate(t, candles);
          out.push({
            key: `${t}|${market}`,
            template: t,
            market,
            net: s.totalNetPct,
            closed: s.closed,
            winRate: s.winRate,
            buyHold,
            eligible: s.closed >= MIN_CLOSED,
          });
        }
      }
      if (out.length === 0)
        throw new Error("Could not load daily candles for any coin. Try again.");
      // Eligible first, then best net return; win rate breaks ties.
      out.sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          b.net - a.net ||
          (b.winRate ?? 0) - (a.winRate ?? 0),
      );
      // Pre-check the single best eligible combo as a sensible default.
      const best = out.find((r) => r.eligible);
      setSel(best ? new Set([best.key]) : new Set());
      setRanDays(days);
      setRows(out);
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "Could not run the comparison. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function addSelected() {
    if (!rows) return;
    const items = rows
      .filter((r) => sel.has(r.key))
      .map((r) => ({ template: r.template, market: r.market }));
    if (items.length === 0) return;
    startAdd(async () => {
      try {
        await addStrategiesAction(items);
        toast(
          `Added ${items.length} ${items.length === 1 ? "strategy" : "strategies"}`,
          "success",
        );
        setSel(new Set());
      } catch (e: any) {
        toast(e?.message ?? "Couldn't add the strategies", "error");
      }
    });
  }

  const rangeLabel =
    RANGES.find((r) => r.days === ranDays)?.label ?? `${ranDays} days`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">
          Compare every strategy across all coins over
        </label>
        <Select
          size="sm"
          ariaLabel="Comparison time range"
          disabled={busy || disabled}
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={RANGES.map((r) => ({
            value: String(r.days),
            label: r.label,
          }))}
        />
        <button
          type="button"
          disabled={busy || disabled}
          onClick={run}
          className="inline-flex items-center gap-2 rounded-md bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden="true">⇄</span>}
          {busy ? "Comparing…" : "Compare the strategies"}
        </button>
      </div>

      {err && (
        <p role="alert" className="text-xs text-loss">
          {err}
        </p>
      )}

      {rows && (
        <div className="rounded-lg bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
              comparison · {markets.length} coins · {rangeLabel}
            </span>
            <span className="text-xs text-muted">
              Check the ones you want, then add them all.
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-faint">
                <tr>
                  <th className="w-6 py-1 pr-2" />
                  <th className="py-1 pr-3 font-medium uppercase tracking-wider">
                    Strategy
                  </th>
                  <th className="py-1 pr-3 font-medium uppercase tracking-wider">
                    Coin
                  </th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">
                    Net
                  </th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">
                    vs hold
                  </th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">
                    Win rate
                  </th>
                  <th className="py-1 text-right font-medium uppercase tracking-wider">
                    Trades
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.015]">
                {rows.map((r) => {
                  const checked = sel.has(r.key);
                  return (
                    <tr
                      key={r.key}
                      className={checked ? "text-fg" : "text-muted"}
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(r.key)}
                          aria-label={`Add ${STRATEGY_META[r.template].label} on ${marketLabel(r.market)}`}
                          className="h-3.5 w-3.5 accent-accent align-middle"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        {STRATEGY_META[r.template].label}
                        {!r.eligible && (
                          <span
                            className="ml-1.5 text-[9px] uppercase text-faint"
                            title={`Fewer than ${MIN_CLOSED} closed trades - not enough evidence`}
                          >
                            low data
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <CoinLogo market={r.market} size={13} />
                          {marketLabel(r.market)}
                        </span>
                      </td>
                      <td
                        className={`py-1.5 pr-3 text-right tnum ${r.net >= 0 ? "text-gain" : "text-loss"}`}
                      >
                        {r.closed ? pct(r.net) : "-"}
                      </td>
                      <td className="py-1.5 pr-3 text-right tnum text-faint">
                        {pct(r.buyHold)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tnum">
                        {r.winRate === null ? "-" : `${r.winRate.toFixed(0)}%`}
                      </td>
                      <td className="py-1.5 text-right tnum">{r.closed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-lg text-[10px] leading-relaxed text-faint">
              Ranked by net return after ~{FRICTION_PCT}% round-trip friction on
              daily candles over {rangeLabel}, the interval the engine trades;
              templates need {MIN_CLOSED}+ closed trades to qualify. Small sample
              - a good score here is a starting point, not a promise of future
              returns.
            </p>
            <button
              type="button"
              disabled={adding || sel.size === 0}
              onClick={addSelected}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding && <Spinner className="h-4 w-4" />}
              Add {sel.size} selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
