"use client";
// "Choose the best strategies for me": a short guided flow next to the
// Your-strategies list. Asks a few plain-English questions (trade frequency,
// what to optimize for, how many coins), then recommends the best-fitting
// strategy per coin - drawn from the active template catalog on each
// template's backtested market, merged with the strategies the user already
// added (which carry realized P&L once there is enough live history).
//
// The questionnaire ends with two actions:
//   Add strategies       - add the recommended picks (and enable ones the
//                          user already has), leaving everything else alone.
//   Replace current      - the same, then remove every current strategy that
//   strategies             is not in the recommendation (confirmed first).
import { useMemo, useState, useTransition } from "react";
import {
  addStrategiesAction,
  removeStrategyAction,
  toggleStrategyAction,
} from "@/app/actions";
import type { StrategyRow, StrategyStat } from "@/lib/queries";
import {
  ACTIVE_TEMPLATES,
  EXPERIMENTAL_TEMPLATES,
  RETIRED_TEMPLATES,
  type Template,
} from "@/lib/entitlements";
import { STRATEGY_META, strategyLabel } from "@/lib/strategies";
import { TEMPLATE_CONFIG } from "@/lib/strategy-sim";
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

interface Rec {
  template: string;
  market: string;
  /** The user's matching row when this pick is already added. */
  existing: StrategyRow | null;
  /** Profit evidence shown next to the name. */
  evidence: string | null;
}

interface Plan {
  recs: Rec[];
  /** Current strategies that "Replace" would remove (everything not recommended). */
  removeOnReplace: StrategyRow[];
}

function buildPlan(
  strategies: StrategyRow[],
  breakdown: StrategyStat[],
  answers: number[],
): Plan {
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

  // Candidates = the user's rows (minus experimental/retired templates, which
  // carry explicit risk warnings and are never auto-picked) merged with every
  // active catalog template on its backtested default market.
  interface Cand {
    template: string;
    market: string;
    existing: StrategyRow | null;
    pnl: number;
    closed: number;
    hasData: boolean;
    backtest?: number;
  }
  const byKey = new Map<string, Cand>();
  for (const s of strategies) {
    if (
      (EXPERIMENTAL_TEMPLATES as readonly string[]).includes(s.template) ||
      (RETIRED_TEMPLATES as readonly string[]).includes(s.template)
    )
      continue;
    const lv = live.get(s.id) ?? { pnl: 0, closed: 0 };
    byKey.set(`${s.template}|${s.market}`, {
      template: s.template,
      market: s.market,
      existing: s,
      pnl: lv.pnl,
      closed: lv.closed,
      hasData: lv.closed >= MIN_CLOSED,
      backtest: STRATEGY_META[s.template as Template]?.backtestNetPct,
    });
  }
  for (const t of ACTIVE_TEMPLATES) {
    const m = TEMPLATE_CONFIG[t].market;
    const key = `${t}|${m}`;
    if (!byKey.has(key))
      byKey.set(key, {
        template: t,
        market: m,
        existing: null,
        pnl: 0,
        closed: 0,
        hasData: false,
        backtest: STRATEGY_META[t].backtestNetPct,
      });
  }

  // Profit ordering first (live P&L with enough history, else backtest), then
  // temperament bonuses scaled to the pool size so preferences reorder near-ties
  // without drowning out a clearly better performer.
  const scored = [...byKey.values()].sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    if (a.hasData && b.hasData) return b.pnl - a.pnl;
    return (b.backtest ?? -Infinity) - (a.backtest ?? -Infinity);
  });
  const n = scored.length;
  const profitWeight = optimize === 0 ? 2 : 1;
  const score = new Map<Cand, number>();
  scored.forEach((c, i) => {
    let pts = (n - i) * profitWeight;
    const t = c.template;
    if (freq === 0) pts += SLOW.has(t) ? n * 0.5 : ACTIVE.has(t) ? -n * 0.25 : 0;
    if (freq === 1) pts += ACTIVE.has(t) ? n * 0.5 : SLOW.has(t) ? -n * 0.25 : 0;
    if (optimize === 1) pts += STEADY.has(t) ? n * 0.75 : -n * 0.25;
    if (optimize === 2) pts += STEADY.has(t) ? n * 0.25 : 0;
    score.set(c, pts);
  });

  // One winner per coin, then the best `cap` coins overall.
  const bestPerMarket = new Map<string, Cand>();
  for (const c of scored) {
    const cur = bestPerMarket.get(c.market);
    if (!cur || (score.get(c) ?? 0) > (score.get(cur) ?? 0))
      bestPerMarket.set(c.market, c);
  }
  const recs = [...bestPerMarket.values()]
    .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))
    .slice(0, cap)
    .map(
      (c): Rec => ({
        template: c.template,
        market: c.market,
        existing: c.existing,
        evidence: c.hasData
          ? `${c.pnl >= 0 ? "+" : ""}${inr(c.pnl)} realized`
          : c.backtest !== undefined
            ? `${c.backtest >= 0 ? "+" : ""}${c.backtest.toFixed(1)}% backtest`
            : null,
      }),
    );

  const keep = new Set(recs.map((r) => r.existing?.id).filter(Boolean));
  return {
    recs,
    removeOnReplace: strategies.filter((s) => !keep.has(s.id)),
  };
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
  const toAdd = plan?.recs.filter((r) => !r.existing) ?? [];
  const toEnable =
    plan?.recs.filter((r) => r.existing && !r.existing.enabled) ?? [];

  function close() {
    setOpen(false);
    setAnswers([]);
  }

  // Shared first half of both actions: add the missing picks, enable the
  // recommended ones that exist but are switched off.
  async function ensureRecommended() {
    if (toAdd.length)
      await addStrategiesAction(
        toAdd.map((r) => ({ template: r.template, market: r.market })),
      );
    // Sequential: each server action revalidates the page; serial keeps them
    // from racing each other's cache invalidation.
    for (const r of toEnable) await toggleStrategyAction(r.existing!.id, true);
  }

  function applyAdd() {
    start(async () => {
      try {
        await ensureRecommended();
        toast(
          toAdd.length || toEnable.length
            ? `Added ${toAdd.length}, enabled ${toEnable.length} — current strategies untouched`
            : "All recommended strategies are already in place",
          "success",
        );
        close();
      } catch (e: any) {
        toast(e?.message ?? "Couldn't add the strategies", "error");
      }
    });
  }

  function applyReplace() {
    if (!plan) return;
    const removed = plan.removeOnReplace;
    if (
      removed.length > 0 &&
      !confirm(
        `Replace your current strategies? This removes ${removed.length} ${
          removed.length === 1 ? "strategy" : "strategies"
        } that ${removed.length === 1 ? "isn't" : "aren't"} in the recommendation. This can't be undone.`,
      )
    )
      return;
    start(async () => {
      try {
        await ensureRecommended();
        for (const s of removed) await removeStrategyAction(s.id);
        toast(
          `Strategies replaced — ${plan.recs.length} recommended, ${removed.length} removed`,
          "success",
        );
        close();
      } catch (e: any) {
        toast(e?.message ?? "Couldn't replace the strategies", "error");
      }
    });
  }

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
            Recommended for your answers — the best-fitting strategy on each of{" "}
            {plan!.recs.length} {plan!.recs.length === 1 ? "coin" : "coins"},
            ranked on realized P&amp;L where there is live history and on
            backtested net return otherwise.
          </p>
          <ul className="mt-2.5 space-y-1">
            {plan!.recs.map((r) => {
              const def =
                r.existing?.template === "custom"
                  ? parseCustomDef(r.existing.params)
                  : null;
              return (
                <li
                  key={`${r.template}|${r.market}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-panel px-3 py-2"
                >
                  <span
                    className={[
                      "w-14 shrink-0 rounded-sm px-1.5 py-0.5 text-center font-mono text-[10px] font-medium uppercase tracking-wider",
                      r.existing ? "bg-inset text-dim" : "bg-gain/15 text-gain",
                    ].join(" ")}
                  >
                    {r.existing ? "have it" : "new"}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg">
                    <CoinLogo market={r.market} size={14} />
                    <span className="truncate">
                      {def ? def.name : strategyLabel(r.template)}
                      <span className="text-muted"> · {marketLabel(r.market)}</span>
                    </span>
                  </span>
                  {r.evidence && (
                    <span className="font-mono text-[11px] tabular-nums text-dim">
                      {r.evidence}
                    </span>
                  )}
                  {r.existing && !r.existing.enabled && (
                    <span className="text-[11px] text-faint">
                      currently disabled — will be enabled
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setAnswers([])}
              className="font-mono text-[11px] text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              ← start over
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={applyAdd}
                title="Add the recommended strategies (and enable recommended ones you already have). Your other strategies are left untouched."
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending && <Spinner className="h-4 w-4" />}
                Add strategies
                {toAdd.length > 0 && (
                  <span className="font-mono text-xs opacity-80">
                    +{toAdd.length}
                  </span>
                )}
              </button>
              {strategies.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={applyReplace}
                  title={
                    plan!.removeOnReplace.length > 0
                      ? `Keep only the recommendation: removes ${plan!.removeOnReplace.length} current ${
                          plan!.removeOnReplace.length === 1
                            ? "strategy"
                            : "strategies"
                        }.`
                      : "Your current strategies already match the recommendation."
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-loss/10 px-4 py-1.5 text-sm font-medium text-loss transition-colors hover:bg-loss/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending && <Spinner className="h-4 w-4" />}
                  Replace current strategies
                  {plan!.removeOnReplace.length > 0 && (
                    <span className="font-mono text-xs opacity-80">
                      −{plan!.removeOnReplace.length}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
          {plan!.removeOnReplace.length > 0 && (
            <p className="mt-2 text-right text-[11px] leading-relaxed text-faint">
              Replace removes the {plan!.removeOnReplace.length} current{" "}
              {plan!.removeOnReplace.length === 1 ? "strategy" : "strategies"}{" "}
              not in this recommendation; Add leaves them untouched.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
