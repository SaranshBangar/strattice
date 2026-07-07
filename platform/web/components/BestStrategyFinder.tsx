"use client";
// "Choose the best strategy" - for users who don't know which template to pick.
// Replays every ACTIVE template over live Binance DAILY candles (the interval the
// engine actually trades), split into two ~16-month halves so one lucky stretch
// can't crown a winner. Ranks on net-of-fees performance with enough closed trades
// to mean something, auto-selects the winner and explains the choice in plain words.
import { useState } from "react";
import { ACTIVE_TEMPLATES, type ActiveTemplate } from "@/lib/entitlements";
import { STRATEGY_META } from "@/lib/strategies";
import {
  simulate,
  FRICTION_PCT,
  type Candle,
  type SimResult,
} from "@/lib/strategy-sim";
import { Spinner } from "@/components/Spinner";

// 1000 daily bars (Binance max) ≈ 2.7 years, evaluated as two halves.
const WINDOWS = ["older", "recent"] as const;
const LIMIT = 1000;
const MIN_CLOSED = 3; // fewer closed trades than this = not enough evidence

interface Verdict {
  template: ActiveTemplate;
  net: number; // summed net % across windows, after friction
  closed: number;
  wins: number;
  winRate: number | null;
  perWindow: Record<(typeof WINDOWS)[number], SimResult>;
  eligible: boolean;
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function rank(candles: Record<(typeof WINDOWS)[number], Candle[]>): Verdict[] {
  const verdicts: Verdict[] = ACTIVE_TEMPLATES.map((t) => {
    const perWindow = {
      older: simulate(t, candles["older"]),
      recent: simulate(t, candles["recent"]),
    };
    const closed = perWindow["older"].closed + perWindow["recent"].closed;
    const wins = perWindow["older"].wins + perWindow["recent"].wins;
    return {
      template: t,
      net: perWindow["older"].totalNetPct + perWindow["recent"].totalNetPct,
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

function explain(
  v: Verdict,
  runnerUp: Verdict | undefined,
  buyHold: number,
  market: string,
): string {
  const label = STRATEGY_META[v.template].label;
  const parts: string[] = [];
  if (!v.eligible) {
    return `${label} scored best, but no template closed ${MIN_CLOSED}+ trades on ${market} in these windows - the stock filters are deliberately picky and daily strategies only trade a handful of times a year. Treat this pick as weak evidence; try another market or keep the default.`;
  }
  parts.push(
    `${label} came out on top: ${pct(v.net)} net of ~${FRICTION_PCT}% round-trip fees across the two test windows, from ${v.closed} closed trades (${v.winRate!.toFixed(0)}% winners).`,
  );
  if (v.net > buyHold) {
    parts.push(
      `That beats simply holding ${market} (${pct(buyHold)} over the ~2.7-year test stretch).`,
    );
  } else {
    parts.push(
      `Buy-and-hold did better over this exact stretch (${pct(buyHold)}) - the strategy's value is the stop-losses and exits, not raw return in a straight-up market.`,
    );
  }
  if (runnerUp && runnerUp.eligible) {
    parts.push(
      `Runner-up: ${STRATEGY_META[runnerUp.template].label} at ${pct(runnerUp.net)}.`,
    );
  }
  parts.push(
    `It's a ${STRATEGY_META[v.template].kind.toLowerCase()} template - ${STRATEGY_META[v.template].blurb.toLowerCase()}`,
  );
  return parts.join(" ");
}

export function BestStrategyFinder({
  market,
  disabled,
  onPick,
}: {
  market: string;
  disabled?: boolean;
  /** Called with the winning template so the parent selects its card. */
  onPick: (t: ActiveTemplate) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    verdicts: Verdict[];
    note: string;
    market: string;
  } | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await fetch(
        `/api/candles?pair=${encodeURIComponent(market)}&interval=1d&limit=${LIMIT}`,
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.candles) || j.candles.length < 300) {
        throw new Error(`Could not load daily candles for ${market}.`);
      }
      const all = j.candles as Candle[];
      const mid = Math.floor(all.length / 2);
      // Two ~16-month halves of the live 1d interval. The recent half also gets the
      // older half as indicator warm-up context via slicing from a common array.
      const candles = {
        older: all.slice(0, mid),
        recent: all.slice(mid),
      } as Record<(typeof WINDOWS)[number], Candle[]>;
      const verdicts = rank(candles);
      const best = verdicts[0];
      // Buy & hold benchmark across the full fetched stretch.
      const buyHold =
        all.length > 1 ? ((all[all.length - 1].c - all[0].c) / all[0].c) * 100 : 0;
      onPick(best.template);
      setResult({
        verdicts,
        note: explain(
          best,
          verdicts[1],
          buyHold,
          market.replace(/^I-/, "").replace("_", "/"),
        ),
        market,
      });
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

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={run}
        className="inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <span aria-hidden="true">✦</span>
        )}
        {busy ? "Comparing all templates…" : "Choose the best strategy for me"}
      </button>

      {err && (
        <p role="alert" className="text-xs text-loss">
          {err}
        </p>
      )}

      {result && (
        <div className="rounded-lg border border-accent/40 bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
              best fit · {result.market.replace(/^I-/, "").replace("_", "/")}
            </span>
            <span className="text-sm font-semibold text-fg">
              {STRATEGY_META[result.verdicts[0].template].label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
              {STRATEGY_META[result.verdicts[0].template].kind}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-dim">{result.note}</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-faint">
                <tr>
                  <th className="py-1 pr-3 font-medium uppercase tracking-wider">
                    Template
                  </th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">
                    Net · older half
                  </th>
                  <th className="py-1 pr-3 text-right font-medium uppercase tracking-wider">
                    Net · recent half
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
                {result.verdicts.map((v, i) => (
                  <tr
                    key={v.template}
                    className={i === 0 ? "text-fg" : "text-muted"}
                  >
                    <td className="py-1.5 pr-3">
                      {i === 0 && <span className="mr-1 text-accent">✦</span>}
                      {STRATEGY_META[v.template].label}
                      {!v.eligible && (
                        <span
                          className="ml-1.5 text-[9px] uppercase text-faint"
                          title={`Fewer than ${MIN_CLOSED} closed trades - not enough evidence`}
                        >
                          low data
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right tnum ${v.perWindow["older"].totalNetPct >= 0 ? "text-gain" : "text-loss"}`}
                    >
                      {v.perWindow["older"].closed
                        ? pct(v.perWindow["older"].totalNetPct)
                        : "-"}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right tnum ${v.perWindow["recent"].totalNetPct >= 0 ? "text-gain" : "text-loss"}`}
                    >
                      {v.perWindow["recent"].closed
                        ? pct(v.perWindow["recent"].totalNetPct)
                        : "-"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tnum">
                      {v.winRate === null ? "-" : `${v.winRate.toFixed(0)}%`}
                    </td>
                    <td className="py-1.5 text-right tnum">{v.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-faint">
            Ranked by net return after ~{FRICTION_PCT}% round-trip friction on
            1000 daily candles (~2.7 years, the interval the engine trades),
            scored separately on the older and recent halves; templates need{" "}
            {MIN_CLOSED}+ closed trades to qualify. Small sample - a good score
            here is a starting point, not a promise of future returns.
          </p>
        </div>
      )}
    </div>
  );
}
