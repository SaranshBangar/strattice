"use client";
// "Choose the best strategy" — for users who don't know which template to pick.
// Replays every builtin template over live CoinDCX candles on two windows
// (15m = the live trading interval, 1h = longer history for robustness),
// ranks them on net-of-fees performance with enough closed trades to mean
// something, auto-selects the winner and explains the choice in plain words.
import { useState } from "react";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "@/lib/entitlements";
import { STRATEGY_META } from "@/lib/strategies";
import { simulate, FRICTION_PCT, type Candle, type SimResult } from "@/lib/strategy-sim";
import { Spinner } from "@/components/Spinner";

// Both windows are 500 bars — 15m matches what the engine actually trades,
// 1h adds ~3 weeks of history so one lucky day can't crown a winner.
const WINDOWS = ["15m", "1h"] as const;
const LIMIT = 500;
const MIN_CLOSED = 3; // fewer closed trades than this = not enough evidence

interface Verdict {
  template: BuiltinTemplate;
  net: number; // summed net % across windows, after friction
  closed: number;
  wins: number;
  winRate: number | null;
  perWindow: Record<(typeof WINDOWS)[number], SimResult>;
  eligible: boolean;
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function rank(candles: Record<(typeof WINDOWS)[number], Candle[]>): Verdict[] {
  const verdicts: Verdict[] = BUILTIN_TEMPLATES.map((t) => {
    const perWindow = {
      "15m": simulate(t, candles["15m"]),
      "1h": simulate(t, candles["1h"]),
    };
    const closed = perWindow["15m"].closed + perWindow["1h"].closed;
    const wins = perWindow["15m"].wins + perWindow["1h"].wins;
    return {
      template: t,
      net: perWindow["15m"].totalNetPct + perWindow["1h"].totalNetPct,
      closed,
      wins,
      winRate: closed ? (wins / closed) * 100 : null,
      perWindow,
      eligible: closed >= MIN_CLOSED,
    };
  });
  // Eligible templates first, then best net return; win rate breaks ties.
  return verdicts.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.net - a.net ||
      (b.winRate ?? 0) - (a.winRate ?? 0),
  );
}

function explain(v: Verdict, runnerUp: Verdict | undefined, buyHold: number, market: string): string {
  const label = STRATEGY_META[v.template].label;
  const parts: string[] = [];
  if (!v.eligible) {
    return `${label} scored best, but no template closed ${MIN_CLOSED}+ trades on ${market} in these windows — the stock filters are deliberately picky and this market has been quiet. Treat this pick as weak evidence; try another market or keep the default.`;
  }
  parts.push(
    `${label} came out on top: ${pct(v.net)} net of ~${FRICTION_PCT}% round-trip fees across the two test windows, from ${v.closed} closed trades (${v.winRate!.toFixed(0)}% winners).`,
  );
  if (v.net > buyHold) {
    parts.push(`That beats simply holding ${market} (${pct(buyHold)} over the ~3-week test stretch).`);
  } else {
    parts.push(`Buy-and-hold did better over this exact stretch (${pct(buyHold)}) — the strategy's value is the stop-losses and exits, not raw return in a straight-up market.`);
  }
  if (runnerUp && runnerUp.eligible) {
    parts.push(`Runner-up: ${STRATEGY_META[runnerUp.template].label} at ${pct(runnerUp.net)}.`);
  }
  parts.push(`It's a ${STRATEGY_META[v.template].kind.toLowerCase()} template — ${STRATEGY_META[v.template].blurb.toLowerCase()}`);
  return parts.join(" ");
}

export function BestStrategyFinder({ market, disabled, onPick }: {
  market: string;
  disabled?: boolean;
  /** Called with the winning template so the parent selects its card. */
  onPick: (t: BuiltinTemplate) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ verdicts: Verdict[]; note: string; market: string } | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const fetched = await Promise.all(
        WINDOWS.map(async (iv) => {
          const r = await fetch(`/api/candles?pair=${encodeURIComponent(market)}&interval=${iv}&limit=${LIMIT}`);
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !Array.isArray(j.candles) || j.candles.length < 50) {
            throw new Error(`Could not load ${iv} candles for ${market}.`);
          }
          return [iv, j.candles as Candle[]] as const;
        }),
      );
      const candles = Object.fromEntries(fetched) as Record<(typeof WINDOWS)[number], Candle[]>;
      const verdicts = rank(candles);
      const best = verdicts[0];
      // Buy & hold benchmark: the 1h window (~3 weeks) contains the 15m window, so
      // its buy & hold covers the whole tested stretch without double counting.
      const buyHold = best.perWindow["1h"].buyHoldPct;
      onPick(best.template);
      setResult({ verdicts, note: explain(best, verdicts[1], buyHold, market.replace(/^I-/, "").replace("_", "/")), market });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not run the comparison. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={run}
        className="inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden="true">✦</span>}
        {busy ? "Comparing all templates…" : "Choose the best strategy for me"}
      </button>

      {err && <p role="alert" className="text-xs text-loss">{err}</p>}

      {result && (
        <div className="rounded-lg border border-accent/40 bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
              best fit · {result.market.replace(/^I-/, "").replace("_", "/")}
            </span>
            <span className="text-sm font-semibold text-fg">{STRATEGY_META[result.verdicts[0].template].label}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
              {STRATEGY_META[result.verdicts[0].template].kind}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-dim">{result.note}</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-faint">
                <tr>
                  <th className="py-1 pr-3 font-medium uppercase tracking-wider">Template</th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">Net 15m</th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">Net 1h</th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">Win rate</th>
                  <th className="py-1 text-right font-medium uppercase tracking-wider">Trades</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {result.verdicts.map((v, i) => (
                  <tr key={v.template} className={i === 0 ? "text-fg" : "text-muted"}>
                    <td className="py-1.5 pr-3">
                      {i === 0 && <span className="mr-1 text-accent">✦</span>}
                      {STRATEGY_META[v.template].label}
                      {!v.eligible && <span className="ml-1.5 text-[9px] uppercase text-faint" title={`Fewer than ${MIN_CLOSED} closed trades — not enough evidence`}>low data</span>}
                    </td>
                    <td className={`py-1.5 pr-3 text-right tnum ${v.perWindow["15m"].totalNetPct >= 0 ? "text-gain" : "text-loss"}`}>
                      {v.perWindow["15m"].closed ? pct(v.perWindow["15m"].totalNetPct) : "—"}
                    </td>
                    <td className={`py-1.5 pr-3 text-right tnum ${v.perWindow["1h"].totalNetPct >= 0 ? "text-gain" : "text-loss"}`}>
                      {v.perWindow["1h"].closed ? pct(v.perWindow["1h"].totalNetPct) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tnum">{v.winRate === null ? "—" : `${v.winRate.toFixed(0)}%`}</td>
                    <td className="py-1.5 text-right tnum">{v.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-faint">
            Ranked by net return after ~{FRICTION_PCT}% round-trip friction on 500×15m + 500×1h live candles;
            templates need {MIN_CLOSED}+ closed trades to qualify. Small sample — a good score here is a
            starting point, not a promise of future returns.
          </p>
        </div>
      )}
    </div>
  );
}
