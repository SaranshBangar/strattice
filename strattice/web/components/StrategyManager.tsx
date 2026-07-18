"use client";
// Strategy picker + manager. Templates are chosen from cards (not a raw dropdown);
// the selected template shows its full config (entry rule, exit rule, editable
// parameters) and a live preview chart of simulated entries/exits before the user
// adds it. Custom (user-built) strategies come from the builder at /strategies/build.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  addStrategiesAction,
  toggleStrategyAction,
  removeStrategyAction,
  setStrategyWeightsAction,
} from "@/app/actions";
import type { StrategyRow, StrategyStat } from "@/lib/queries";
import {
  ACTIVE_TEMPLATES,
  EXPERIMENTAL_TEMPLATES,
  isShortCapable,
  type BuiltinTemplate,
  type PickableTemplate,
  type Template,
} from "@/lib/entitlements";
import { STRATEGY_META, strategyLabel } from "@/lib/strategies";
import {
  TEMPLATE_CONFIG,
  paramRuleError,
  type ParamSpec,
} from "@/lib/strategy-sim";
import {
  parseCustomDef,
  describeRule,
  describeExits,
} from "@/lib/custom-strategy";
import { StrategyPreview } from "@/components/StrategyPreview";
import { BestStrategyFinder } from "@/components/BestStrategyFinder";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";
import { inr } from "@/lib/dashboard-format";

export const MARKETS = [
  "I-BTC_INR",
  "I-ETH_INR",
  "I-SOL_INR",
  "I-XRP_INR",
  "I-BNB_INR",
  "I-DOGE_INR",
];

const marketLabel = (m: string) => m.replace(/^I-/, "").replace("_", "/");

function ParamInput({
  spec,
  value,
  stock,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  stock: number;
  onChange: (v: number) => void;
}) {
  const customised = value !== stock;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label htmlFor={`p-${spec.key}`} className="text-xs text-muted">
        {spec.label}
        {customised && (
          <span className="ml-1.5 text-[10px] text-accent">●</span>
        )}
      </label>
      <input
        id={`p-${spec.key}`}
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(spec.int ? Math.round(n) : n);
        }}
        className={[
          "w-24 rounded-md border bg-inset px-2 py-1 text-right font-mono text-xs tabular-nums text-fg",
          "focus:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          customised ? "border-accent/50" : "border-line",
        ].join(" ")}
      />
    </div>
  );
}

function ConfigRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-mono text-xs tabular-nums text-dim">{v}</dd>
    </div>
  );
}

// Below this many CLOSED trades a strategy has too little live history to rank on
// realized P&L, so we fall back to its backtested return instead.
const MIN_CLOSED = 3;

// Engine strategy names are "<template>_<idx>" (worker/config_gen.py); the trades read
// model keys P&L by that name, so strip the index to match a stored template row.
const templateOf = (engineName: string) => engineName.replace(/_\d+$/, "");

export function StrategyManager({
  strategies,
  breakdown = [],
  allowShorting = false,
}: {
  strategies: StrategyRow[];
  /** Per-strategy, per-market realized P&L (executed orders) for profit ranking. */
  breakdown?: StrategyStat[];
  /** The user's Settings opt-in for short-capable templates; off = those cards lock. */
  allowShorting?: boolean;
}) {
  const [pending, start] = useTransition();
  const [tpl, setTpl] = useState<PickableTemplate>(ACTIVE_TEMPLATES[0]);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([
    TEMPLATE_CONFIG[ACTIVE_TEMPLATES[0]].market,
  ]);
  const [customMarket, setCustomMarket] = useState("");
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  // Realized P&L per stored strategy, aggregated from the trades read model by matching
  // template + market. Wins+losses give the CLOSED-trade count that decides whether there
  // is enough live history to trust the P&L.
  const liveStat = useMemo(() => {
    const byRow = new Map<string, { pnl: number; closed: number }>();
    for (const s of strategies) {
      let pnl = 0;
      let closed = 0;
      for (const b of breakdown) {
        if (b.market === s.market && templateOf(b.strategy) === s.template) {
          pnl += b.pnl;
          closed += b.wins + b.losses;
        }
      }
      byRow.set(s.id, { pnl, closed });
    }
    return byRow;
  }, [strategies, breakdown]);

  // Rank the selected strategies by profit: those with real trading history sort first by
  // realized P&L; those still thin on data fall back to their backtested net return so a
  // freshly added strategy still lands somewhere sensible instead of a flat ₹0.
  const ranked = useMemo(() => {
    return strategies
      .map((s) => {
        const live = liveStat.get(s.id) ?? { pnl: 0, closed: 0 };
        const hasData = live.closed >= MIN_CLOSED;
        const backtest = STRATEGY_META[s.template as Template]?.backtestNetPct;
        return { s, pnl: live.pnl, closed: live.closed, hasData, backtest };
      })
      .sort((a, b) => {
        if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
        if (a.hasData && b.hasData) return b.pnl - a.pnl;
        return (b.backtest ?? -Infinity) - (a.backtest ?? -Infinity);
      });
  }, [strategies, liveStat]);

  const allSelected =
    strategies.length > 0 && selected.size === strategies.length;

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((cur) =>
      cur.size === strategies.length
        ? new Set()
        : new Set(strategies.map((s) => s.id)),
    );
  }

  function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "strategy" : "strategies";
    if (!confirm(`Remove ${ids.length} ${noun}? This can't be undone.`)) return;
    run(async () => {
      // Sequential: each removeStrategyAction revalidates the page, so serial keeps the
      // server actions from racing each other's cache invalidation.
      for (const id of ids) await removeStrategyAction(id);
      setSelected(new Set());
    }, `Removed ${ids.length} ${noun}`);
  }

  const meta = STRATEGY_META[tpl];
  const cfg = TEMPLATE_CONFIG[tpl];
  // The first checked coin drives the single-market live preview.
  const market = selectedMarkets[0] ?? "";
  const marketValid =
    selectedMarkets.length > 0 && /^[A-Z0-9_-]{3,24}$/.test(market);

  // Current param values = stock + edits; only genuine diffs are sent to the server.
  const paramValues = useMemo(() => {
    const v: Record<string, number> = {};
    for (const s of cfg.editable) v[s.key] = edits[s.key] ?? cfg.params[s.key];
    return v;
  }, [cfg, edits]);
  const diffs = useMemo(() => {
    const d: Record<string, number> = {};
    for (const s of cfg.editable) {
      const val = Math.min(s.max, Math.max(s.min, paramValues[s.key]));
      if (val !== cfg.params[s.key]) d[s.key] = val;
    }
    return d;
  }, [cfg, paramValues]);
  const customised = Object.keys(diffs).length > 0;
  const ruleErr = paramRuleError(tpl, { ...cfg.params, ...diffs });

  function run(fn: () => Promise<void>, ok?: string) {
    setErr(null);
    start(async () => {
      try {
        await fn();
        if (ok) toast(ok, "success");
      } catch (e: any) {
        const msg = e.message ?? "Something went wrong. Please try again.";
        setErr(msg);
        toast(msg, "error");
      }
    });
  }

  // Short-capable templates are pickable (so the warning is readable) but cannot be
  // ADDED until the Settings permission is on; the server re-enforces this.
  const tplShort = isShortCapable(tpl);
  const shortLocked = tplShort && !allowShorting;

  function pickTemplate(t: PickableTemplate) {
    setTpl(t);
    setEdits({});
    setSelectedMarkets([TEMPLATE_CONFIG[t].market]);
  }

  function toggleMarket(m: string) {
    setSelectedMarkets((cur) =>
      cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
    );
  }

  function addCustomMarket() {
    const m = customMarket.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(m)) {
      setErr("Enter a valid market id, e.g. I-BTC_INR");
      return;
    }
    setErr(null);
    setSelectedMarkets((cur) => (cur.includes(m) ? cur : [...cur, m]));
    setCustomMarket("");
  }

  const exits = cfg.exits;
  const exitRows: [string, string][] = [
    ["Hard stop", `-${(exits.stopLossPct * 100).toFixed(1)}%`],
    [
      "Take-profit",
      exits.takeProfitPct > 0
        ? `+${(exits.takeProfitPct * 100).toFixed(1)}%`
        : "none (let it run)",
    ],
    [
      "ATR trail",
      exits.chandelierK > 0
        ? `${exits.chandelierK}× ATR(${exits.atrPeriod}) off the peak`
        : "none",
    ],
    ["Time-stop", exits.maxHoldBars > 0 ? `${exits.maxHoldBars} bars` : "none"],
  ];

  return (
    <div className="space-y-6">
      {/* 1 · pick a template */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow">01 · Pick a template - or build your own</h2>
        </div>
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
          role="radiogroup"
          aria-label="Strategy template"
        >
          {[...ACTIVE_TEMPLATES, ...EXPERIMENTAL_TEMPLATES].map((t) => {
            const m = STRATEGY_META[t];
            const active = t === tpl;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickTemplate(t)}
                className={[
                  "rounded-lg p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active
                    ? "bg-panel ring-1 ring-accent/50"
                    : "bg-white/[0.03] hover:bg-panel",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-medium ${active ? "text-fg" : "text-dim"}`}
                  >
                    {m.label}
                  </span>
                  <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                    {m.kind}
                    {isShortCapable(t) && !allowShorting ? " · locked" : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  {m.blurb}
                </p>
              </button>
            );
          })}
          {/* build-your-own card */}
          <Link
            href="/strategies/build"
            className="group flex flex-col justify-between rounded-lg border border-dashed border-accent/50 bg-panel p-3 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-accent">
                Build your own
              </span>
              <span className="shrink-0 rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
                BUILDER
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Compose entry rules from indicator blocks and backtest them live
              while you design.
            </p>
            <span className="mt-2 text-xs font-medium text-accent group-hover:underline">
              Open the builder →
            </span>
          </Link>
        </div>

        {/* not sure which one? compare every template on every coin over a chosen
            range, then add any of the winners in one go */}
        <div className="mt-3">
          <BestStrategyFinder markets={MARKETS} disabled={pending} />
        </div>
      </section>

      {/* 2 · config + live preview */}
      <section className="overflow-hidden card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="eyebrow">02 · {meta.label} - config &amp; preview</h2>
          <button
            type="button"
            disabled={
              pending || selectedMarkets.length === 0 || !!ruleErr || shortLocked
            }
            onClick={() =>
              run(
                () =>
                  addStrategiesAction(
                    selectedMarkets.map((m) => ({
                      template: tpl,
                      market: m,
                      // Short-capable templates always send the FULL param set so the
                      // mandatory stop-loss/take-profit are explicit in the stored row
                      // (the server refuses the add without them).
                      params: tplShort
                        ? JSON.stringify(paramValues)
                        : customised
                          ? JSON.stringify(diffs)
                          : null,
                    })),
                  ),
                `Added ${meta.label} to ${selectedMarkets.length} ${
                  selectedMarkets.length === 1 ? "coin" : "coins"
                }`,
              )
            }
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Spinner className="h-4 w-4" />}
            {selectedMarkets.length > 1
              ? `Add to ${selectedMarkets.length} coins`
              : "Add strategy"}
          </button>
        </div>

        {/* pick one or more coins: this template gets added to every checked coin */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-faint">
            Coins
          </span>
          {MARKETS.map((m) => {
            const on = selectedMarkets.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleMarket(m)}
                className={[
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on
                    ? "bg-accent/15 text-accent ring-1 ring-accent/50"
                    : "bg-white/[0.03] text-dim hover:bg-panel",
                ].join(" ")}
              >
                {marketLabel(m)}
              </button>
            );
          })}
          {/* custom coins the user typed that aren't presets */}
          {selectedMarkets
            .filter((m) => !MARKETS.includes(m))
            .map((m) => (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked
                onClick={() => toggleMarket(m)}
                title="Remove"
                className="rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent ring-1 ring-accent/50 transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {marketLabel(m)} ✕
              </button>
            ))}
          <input
            value={customMarket}
            onChange={(e) => setCustomMarket(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomMarket();
              }
            }}
            placeholder="I-BTC_INR"
            aria-label="Custom market id"
            className="w-32 rounded-md border border-line bg-inset px-2.5 py-1 font-mono text-xs uppercase text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="button"
            onClick={addCustomMarket}
            className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-dim transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Add coin
          </button>
        </div>

        {err && (
          <p role="alert" className="px-4 py-2 text-sm text-loss">
            {err}
          </p>
        )}

        {meta.warning && (
          <div
            role="alert"
            className="mx-4 mb-1 rounded-md bg-loss/10 px-3 py-2.5 text-xs leading-relaxed text-loss"
          >
            <span className="font-semibold">⚠ Risk warning: </span>
            {meta.warning}
          </div>
        )}

        {tplShort && (
          <div
            role="alert"
            className="mx-4 mb-1 rounded-md bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-warn"
          >
            <span className="font-semibold">Short-capable strategy: </span>
            a stop-loss AND take-profit are mandatory - set both in Parameters
            before adding.{" "}
            {shortLocked && (
              <>
                Adding is locked until you enable{" "}
                <Link
                  href="/settings"
                  className="font-medium underline underline-offset-2 hover:text-fg"
                >
                  “Allow short-capable strategies” in Settings
                </Link>
                .
              </>
            )}
          </div>
        )}

        <div className="grid gap-0 lg:grid-cols-[320px_1fr]">
          {/* config sidebar */}
          <div className="space-y-4 p-4">
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Enters when
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                {meta.entry}
              </p>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Exits via
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                {meta.exit}
              </p>
              <dl className="mt-2 rounded-md bg-inset px-3 py-1">
                {exitRows.map(([k, v]) => (
                  <ConfigRow key={k} k={k} v={v} />
                ))}
              </dl>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
                  Parameters{" "}
                  {customised && (
                    <span className="ml-1 normal-case text-accent">
                      · customised
                    </span>
                  )}
                </h3>
                {customised && (
                  <button
                    type="button"
                    onClick={() => setEdits({})}
                    className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    Reset to stock
                  </button>
                )}
              </div>
              <div className="mt-2 rounded-md bg-inset px-3 py-1">
                {cfg.editable.map((spec) => (
                  <ParamInput
                    key={`${tpl}-${spec.key}`}
                    spec={spec}
                    value={paramValues[spec.key]}
                    stock={cfg.params[spec.key]}
                    onChange={(v) => setEdits((e) => ({ ...e, [spec.key]: v }))}
                  />
                ))}
              </div>
              {ruleErr ? (
                <p
                  role="alert"
                  className="mt-2 text-[11px] leading-relaxed text-loss"
                >
                  {ruleErr}
                </p>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Edit a value and the preview re-simulates instantly. The stock
                  values are the backtested defaults - customise with care.
                </p>
              )}
            </div>
            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-dim">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">
                  ▸
                </span>
                How this strategy works
              </summary>
              <div className="mt-2 space-y-2">
                {meta.explain.map((p, i) => (
                  <p key={i} className="text-xs leading-relaxed text-dim">
                    {p}
                  </p>
                ))}
                <p className="text-xs leading-relaxed text-muted">
                  <span className="text-faint">Style:</span> {meta.style}
                </p>
              </div>
            </details>
          </div>

          {/* live preview */}
          <div className="p-4">
            {tplShort ? (
              <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line px-6 text-center text-sm text-muted">
                <div>
                  <p>
                    No browser preview: the in-browser simulator is long-only
                    and cannot express this strategy's short side.
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    On the live spot engine only the long entries execute;
                    watch the full long/short behavior in DRY_RUN first.
                  </p>
                </div>
              </div>
            ) : (EXPERIMENTAL_TEMPLATES as readonly string[]).includes(tpl) ? (
              <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line px-6 text-center text-sm text-muted">
                <div>
                  <p>
                    No browser preview: this strategy's decisions come from a
                    Hugging Face model that runs only inside the bot's engine.
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    Enable it in DRY_RUN mode to watch it paper-trade before
                    committing real capital.
                  </p>
                </div>
              </div>
            ) : marketValid ? (
              <StrategyPreview
                template={tpl as BuiltinTemplate}
                market={market}
                params={ruleErr ? null : diffs}
              />
            ) : (
              <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line text-sm text-muted">
                Enter a market id (e.g. I-BTC_INR) to preview.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3 · your strategies — ranked by profit (backtest as a fallback for thin data) */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="eyebrow">03 · Your strategies</h2>
            <span className="font-mono text-[10px] normal-case text-faint">
              ranked by profit
            </span>
          </div>
          <span className="font-mono text-[11px] text-faint">
            {strategies.filter((s) => s.enabled).length} active · no cap
          </span>
        </div>
        {strategies.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No strategies yet. Pick a template above, preview it, and add it.
          </div>
        ) : (
          <>
            {/* bulk-select toolbar: select all + remove the checked strategies at once */}
            <div className="flex flex-wrap items-center gap-3 border-t border-line bg-white/[0.015] px-4 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all strategies"
                  className="h-3.5 w-3.5 cursor-pointer accent-accent"
                />
                Select all
              </label>
              {selected.size > 0 && (
                <>
                  <span className="font-mono text-[11px] text-faint">
                    {selected.size} selected
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={removeSelected}
                    className="inline-flex items-center gap-1.5 rounded-md bg-loss/10 px-2.5 py-1 text-xs font-medium text-loss transition-colors hover:bg-loss/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:opacity-50"
                  >
                    {pending && <Spinner className="h-3.5 w-3.5" />}
                    Remove selected
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setSelected(new Set())}
                    className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
            <ul>
              {ranked.map(({ s, pnl, hasData, backtest }, i) => {
                const enabled = !!s.enabled;
                const def =
                  s.template === "custom" ? parseCustomDef(s.params) : null;
                const checked = selected.has(s.id);
                return (
                  <li
                    key={s.id}
                    className={[
                      "flex items-center gap-3 px-4 py-3 transition-colors",
                      checked ? "bg-accent/[0.06]" : "",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(s.id)}
                      aria-label={`Select ${def ? def.name : strategyLabel(s.template)} on ${s.market}`}
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
                    />
                    <span className="w-6 shrink-0 text-center font-mono text-xs tabular-nums text-faint">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">
                          {def ? def.name : strategyLabel(s.template)}
                        </span>
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] font-medium text-dim">
                          {s.market}
                        </span>
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                          {STRATEGY_META[s.template as Template]?.kind ??
                            "custom"}
                        </span>
                        {/* Profit badge: realized ₹ P&L once there is enough live
                            history, otherwise the backtested net return as a stand-in. */}
                        {hasData ? (
                          <span
                            className={[
                              "rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
                              pnl > 0
                                ? "bg-gain/15 text-gain"
                                : pnl < 0
                                  ? "bg-loss/15 text-loss"
                                  : "bg-inset text-dim",
                            ].join(" ")}
                            title="Realized P&L from your executed trades"
                          >
                            {pnl >= 0 ? "+" : ""}
                            {inr(pnl)}
                          </span>
                        ) : backtest !== undefined ? (
                          <span
                            className={[
                              "rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
                              backtest >= 0
                                ? "bg-gain/10 text-gain/90"
                                : "bg-loss/10 text-loss/90",
                            ].join(" ")}
                            title="Backtested net return — shown until this strategy has enough live trades to rank on real P&L"
                          >
                            {backtest >= 0 ? "+" : ""}
                            {backtest.toFixed(1)}% backtest
                          </span>
                        ) : (
                          <span
                            className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] text-faint"
                            title="No trading history or backtest yet"
                          >
                            no data yet
                          </span>
                        )}
                        {s.params && s.template !== "custom" && (
                          <span
                            className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                            title={s.params}
                          >
                            custom params
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <span
                          className={[
                            "h-1.5 w-1.5 rounded-[1px]",
                            enabled ? "bg-gain" : "bg-faint",
                          ].join(" ")}
                        />
                        {enabled ? "Enabled" : "Disabled"}
                        {def && (
                          <span className="ml-1 truncate text-faint">
                            · {def.rules.map(describeRule).join(" AND ")} ·
                            exits: {describeExits(def.exits)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => toggleStrategyAction(s.id, !s.enabled),
                            enabled ? "Strategy disabled" : "Strategy enabled",
                          )
                        }
                        className={[
                          "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
                          enabled
                            ? "bg-white/5 text-dim hover:bg-white/10"
                            : "bg-gain/10 text-gain hover:bg-gain/20",
                        ].join(" ")}
                      >
                        {enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !confirm(
                              `Remove ${def ? def.name : strategyLabel(s.template)} on ${s.market}? This can't be undone.`,
                            )
                          )
                            return;
                          run(
                            () => removeStrategyAction(s.id),
                            "Strategy removed",
                          );
                        }}
                        className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-loss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <StrategySplit strategies={strategies} />
      </section>
    </div>
  );
}

function StrategySplit({ strategies }: { strategies: StrategyRow[] }) {
  const enabled = strategies.filter((s) => s.enabled);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const toast = useToast();

  if (enabled.length < 2) return null;

  const value = (id: string, stock: number) => edits[id] ?? stock;
  const total =
    enabled.reduce((sum, s) => sum + value(s.id, s.weight), 0) || 1;
  const dirty = enabled.some(
    (s) => edits[s.id] !== undefined && edits[s.id] !== s.weight,
  );

  function save() {
    const weights: Record<string, number> = {};
    for (const s of enabled) weights[s.id] = value(s.id, s.weight);
    start(async () => {
      try {
        await setStrategyWeightsAction(weights);
        setEdits({});
        toast("Capital split saved", "success");
      } catch (e: any) {
        toast(e?.message ?? "Couldn't save the split", "error");
      }
    });
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] uppercase tracking-wider text-faint">
          Split capital across {enabled.length} active strategies
        </h3>
        <button
          type="button"
          onClick={() =>
            setEdits(Object.fromEntries(enabled.map((s) => [s.id, 1])))
          }
          className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          Equal split
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {enabled.map((s) => {
          const v = value(s.id, s.weight);
          const pct = Math.round((v / total) * 100);
          const def = s.template === "custom" ? parseCustomDef(s.params) : null;
          const label = def ? def.name : strategyLabel(s.template);
          return (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-dim">
                {label} <span className="text-faint">· {s.market}</span>
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={v}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0)
                      setEdits((cur) => ({ ...cur, [s.id]: n }));
                  }}
                  aria-label={`Weight for ${label}`}
                  className="w-16 rounded-md border border-line bg-inset px-2 py-1 text-right font-mono text-xs tabular-nums text-fg focus:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
                <span className="w-10 text-right font-mono text-xs tabular-nums text-faint">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-faint">
          Higher weight = more capital per trade. Shares are relative, not
          fixed percentages - 1/1 and 50/50 behave identically.
        </p>
        {dirty && (
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save split"}
          </button>
        )}
      </div>
    </div>
  );
}
