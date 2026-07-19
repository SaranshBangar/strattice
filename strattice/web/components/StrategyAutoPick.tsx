"use client";
// "Choose the best strategies for me": a short guided flow next to the
// Your-strategies list. Asks a few plain-English questions (trade frequency,
// what to optimize for, how many coins), scores the strategies the user has
// already added - realized P&L when there is enough live history, backtested
// net return otherwise - and proposes which ones to enable and which to
// disable. Nothing changes until the user reviews the plan and applies it;
// applying just flips the enable switches (no rows are added or removed).
import { useMemo, useState, useTransition } from "react";
import { toggleStrategyAction } from "@/app/actions";
import type { StrategyRow, StrategyStat } from "@/lib/queries";
import {
  EXPERIMENTAL_TEMPLATES,
  RETIRED_TEMPLATES,
  type Template,
} from "@/lib/entitlements";
import { STRATEGY_META, strategyLabel } from "@/lib/strategies";
import { parseCustomDef } from "@/lib/custom-strategy";
import { marketLabel } from "@/lib/coins";
import { CoinLogo } from "@/components/CoinLogo";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";
import { inr } from "@/lib/dashboard-format";

// Template temperament, mirroring the descriptions in lib/strategies.ts:
// SLOW = patient regime/trend holders (a handful of trades a year);
// ACTIVE = event-driven engines that fire on breakouts and expansions;
// STEADY = engines with their own tighter exit line (shallower swings).
const SLOW = new Set(["trend_regime", "tsmom", "ma_crossover", "sharpe_mom", "ichimoku"]);
const ACTIVE = new Set(["momentum", "squeeze_breakout", "vol_expansion", "macd_trend", "supertrend"]);
const STEADY = new Set(["supertrend", "ichimoku", "ma_crossover", "trend_regime"]);

const MIN_CLOSED = 3; // same live-history bar the ranked list uses

const QUESTIONS: { q: string; options: string[] }[] = [
  {
    q: "How often do you want the bot to trade?",
    options: [
      "Rarely — a few patient trades a year is fine",
      "More often — act whenever something genuinely breaks out",
      "No preference — whatever has performed best",
    ],
  },
  {
    q: "What should the selection optimize for?",
    options: [
      "Most profitable — rank purely on measured returns",
      "Steadier ride — shallower swings over peak returns",
      "Balanced — returns first, but lean on the calmer engines",
    ],
  },
  {
    q: "How many coins do you want trading at once?",
    options: [
      "Focus on a single coin",
      "A small basket — up to 3 coins",
      "Diversify — up to 6 coins",
    ],
  },
];
const COIN_CAPS = [1, 3, 6];

// Engine strategy names are "<template>_<idx>"; strip the index to match rows.
const templateOf = (engineName: string) => engineName.replace(/_\d+$/, "");

interface PlanRow {
  s: StrategyRow;
  enable: boolean;
  changed: boolean;
  reason: string;
  /** Profit evidence shown next to the name. */
  evidence: string | null;
}

function buildPlan(
  strategies: StrategyRow[],
  breakdown: StrategyStat[],
  answers: number[],
): PlanRow[] {
  const [freq, optimize, coins] = answers;
  const cap = COIN_CAPS[coins] ?? 3;

  // Live realized P&L + closed-trade count per row, from the trades read model.
  const live = new Map<string, { pnl: number; closed: number }>();
  for (const s of strategies) {
    let pnl = 0;
    let closed = 0;
    for (const b of breakdown) {
      if (b.market === s.market && templateOf(b.strategy) === s.template) {
        pnl += b.pnl;
        closed += b.wins + b.losses;
      }
    }
    live.set(s.id, { pnl, closed });
  }

  // Experimental (incl. short-capable) and retired templates are never
  // auto-enabled - they carry explicit risk warnings and stay a manual choice.
  const excluded = new Map<string, string>();
  for (const s of strategies) {
    if ((EXPERIMENTAL_TEMPLATES as readonly string[]).includes(s.template))
      excluded.set(s.id, "experimental — enable manually if you want it");
    else if ((RETIRED_TEMPLATES as readonly string[]).includes(s.template))
      excluded.set(s.id, "retired template — loses money net of fees");
  }
  const candidates = strategies.filter((s) => !excluded.has(s.id));

  // Profit ordering first (live P&L with enough history, else backtest), then
  // temperament bonuses scaled to the pool size so preferences reorder near-ties
  // without drowning out a clearly better performer.
  const scored = candidates
    .map((s) => {
      const lv = live.get(s.id) ?? { pnl: 0, closed: 0 };
      const hasData = lv.closed >= MIN_CLOSED;
      const backtest = STRATEGY_META[s.template as Template]?.backtestNetPct;
      return { s, hasData, pnl: lv.pnl, backtest };
    })
    .sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      if (a.hasData && b.hasData) return b.pnl - a.pnl;
      return (b.backtest ?? -Infinity) - (a.backtest ?? -Infinity);
    });
  const n = scored.length;
  const profitWeight = optimize === 0 ? 2 : 1;
  const score = new Map<string, number>();
  scored.forEach((row, i) => {
    let pts = (n - i) * profitWeight;
    const t = row.s.template;
    if (freq === 0) pts += SLOW.has(t) ? n * 0.5 : ACTIVE.has(t) ? -n * 0.25 : 0;
    if (freq === 1) pts += ACTIVE.has(t) ? n * 0.5 : SLOW.has(t) ? -n * 0.25 : 0;
    if (optimize === 1) pts += STEADY.has(t) ? n * 0.75 : -n * 0.25;
    if (optimize === 2) pts += STEADY.has(t) ? n * 0.25 : 0;
    score.set(row.s.id, pts);
  });

  // One winner per coin, then the best `cap` coins overall.
  const bestPerMarket = new Map<string, StrategyRow>();
  for (const { s } of scored) {
    const cur = bestPerMarket.get(s.market);
    if (!cur || (score.get(s.id) ?? 0) > (score.get(cur.id) ?? 0))
      bestPerMarket.set(s.market, s);
  }
  const chosenMarkets = [...bestPerMarket.entries()]
    .sort((a, b) => (score.get(b[1].id) ?? 0) - (score.get(a[1].id) ?? 0))
    .slice(0, cap)
    .map(([m]) => m);
  const enableIds = new Set(
    chosenMarkets.map((m) => bestPerMarket.get(m)!.id),
  );

  return strategies.map((s): PlanRow => {
    const lv = live.get(s.id) ?? { pnl: 0, closed: 0 };
    const backtest = STRATEGY_META[s.template as Template]?.backtestNetPct;
    const evidence =
      lv.closed >= MIN_CLOSED
        ? `${lv.pnl >= 0 ? "+" : ""}${inr(lv.pnl)} realized`
        : backtest !== undefined
          ? `${backtest >= 0 ? "+" : ""}${backtest.toFixed(1)}% backtest`
          : null;
    const enable = enableIds.has(s.id);
    let reason: string;
    if (enable) {
      reason = `best fit on ${marketLabel(s.market)} for your answers`;
    } else if (excluded.has(s.id)) {
      reason = excluded.get(s.id)!;
    } else if (
      bestPerMarket.get(s.market) &&
      bestPerMarket.get(s.market)!.id !== s.id &&
      chosenMarkets.includes(s.market)
    ) {
      reason = `outranked by ${strategyLabel(bestPerMarket.get(s.market)!.template)} on the same coin`;
    } else {
      reason = `outside your ${cap}-coin limit`;
    }
    return { s, enable, changed: enable !== !!s.enabled, reason, evidence };
  });
}

export function StrategyAutoPick({
  strategies,
  breakdown = [],
  disabled,
}: {
  strategies: StrategyRow[];
  breakdown?: StrategyStat[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const step = answers.length;
  const done = step >= QUESTIONS.length;

  const plan = useMemo(
    () => (done ? buildPlan(strategies, breakdown, answers) : null),
    [done, strategies, breakdown, answers],
  );
  const changes = plan?.filter((p) => p.changed) ?? [];

  function reset() {
    setAnswers([]);
  }
  function close() {
    setOpen(false);
    setAnswers([]);
  }

  function apply() {
    if (!plan) return;
    const toFlip = plan.filter((p) => p.changed);
    start(async () => {
      try {
        // Sequential: each toggle revalidates the page; serial keeps the server
        // actions from racing each other's cache invalidation.
        for (const p of toFlip) await toggleStrategyAction(p.s.id, p.enable);
        const on = toFlip.filter((p) => p.enable).length;
        const off = toFlip.length - on;
        toast(
          `Strategy selection updated — enabled ${on}, disabled ${off}`,
          "success",
        );
        close();
      } catch (e: any) {
        toast(e?.message ?? "Couldn't update the selection", "error");
      }
    });
  }

  if (strategies.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true">✦</span>
        Choose the best strategies for me
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg bg-inset/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          choose the best strategies for me
        </span>
        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5"
            aria-label={
              done
                ? "All questions answered"
                : `Question ${step + 1} of ${QUESTIONS.length}`
            }
          >
            {QUESTIONS.map((_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-[1px] transition-colors ${
                  i < step ? "bg-accent" : i === step && !done ? "bg-dim" : "bg-line"
                }`}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="font-mono text-xs text-faint transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            ✕
          </button>
        </div>
      </div>

      {!done ? (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-fg">{QUESTIONS[step].q}</h4>
          <div className="mt-2.5 space-y-1.5">
            {QUESTIONS[step].options.map((o, i) => (
              <button
                key={o}
                type="button"
                onClick={() => setAnswers((a) => [...a, i])}
                className="flex w-full items-center gap-3 rounded-md bg-panel px-3.5 py-2.5 text-left text-sm text-dim transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-mono text-[11px] text-faint">
                  {String.fromCharCode(97 + i)}
                </span>
                {o}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setAnswers((a) => a.slice(0, -1))}
              className="mt-3 font-mono text-[11px] text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              ← back
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-muted">
            The plan below only flips the enable switches on strategies you
            already added — review it, then apply.
          </p>
          <ul className="mt-2.5 space-y-1">
            {plan!.map(({ s, enable, changed, reason, evidence }) => {
              const def =
                s.template === "custom" ? parseCustomDef(s.params) : null;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-panel px-3 py-2"
                >
                  <span
                    className={[
                      "w-16 shrink-0 rounded-sm px-1.5 py-0.5 text-center font-mono text-[10px] font-medium uppercase tracking-wider",
                      enable
                        ? "bg-gain/15 text-gain"
                        : "bg-inset text-faint",
                    ].join(" ")}
                  >
                    {enable ? "on" : "off"}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg">
                    <CoinLogo market={s.market} size={14} />
                    <span className="truncate">
                      {def ? def.name : strategyLabel(s.template)}
                      <span className="text-muted"> · {marketLabel(s.market)}</span>
                    </span>
                  </span>
                  {evidence && (
                    <span className="font-mono text-[11px] tabular-nums text-dim">
                      {evidence}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-right text-[11px] text-faint">
                    {changed ? reason : `${reason} · no change`}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={reset}
              className="font-mono text-[11px] text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              ← start over
            </button>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-faint">
                {changes.length === 0
                  ? "already matches your answers"
                  : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
              </span>
              <button
                type="button"
                disabled={pending || changes.length === 0}
                onClick={apply}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending && <Spinner className="h-4 w-4" />}
                Apply selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
