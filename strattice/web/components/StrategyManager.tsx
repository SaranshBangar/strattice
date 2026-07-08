"use client";
// Strategy picker + manager. Templates are chosen from cards (not a raw dropdown);
// the selected template shows its full config (entry rule, exit rule, editable
// parameters) and a live preview chart of simulated entries/exits before the user
// adds it. Custom (user-built) strategies come from the builder at /strategies/build.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  addStrategyAction,
  toggleStrategyAction,
  removeStrategyAction,
} from "@/app/actions";
import type { StrategyRow } from "@/lib/queries";
import {
  ACTIVE_TEMPLATES,
  EXPERIMENTAL_TEMPLATES,
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
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

export const MARKETS = [
  "I-BTC_INR",
  "I-ETH_INR",
  "I-SOL_INR",
  "I-XRP_INR",
  "I-BNB_INR",
  "I-DOGE_INR",
];
const CUSTOM_MARKET = "__custom__";

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

export function StrategyManager({ strategies }: { strategies: StrategyRow[] }) {
  const [pending, start] = useTransition();
  const [tpl, setTpl] = useState<PickableTemplate>(ACTIVE_TEMPLATES[0]);
  const [marketSel, setMarketSel] = useState<string>(
    TEMPLATE_CONFIG[ACTIVE_TEMPLATES[0]].market,
  );
  const [customMarket, setCustomMarket] = useState("");
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const meta = STRATEGY_META[tpl];
  const cfg = TEMPLATE_CONFIG[tpl];
  const market =
    marketSel === CUSTOM_MARKET ? customMarket.trim().toUpperCase() : marketSel;
  const marketValid = /^[A-Z0-9_-]{3,24}$/.test(market);

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

  function pickTemplate(t: PickableTemplate) {
    setTpl(t);
    setEdits({});
    if (marketSel !== CUSTOM_MARKET) setMarketSel(TEMPLATE_CONFIG[t].market);
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

        {/* not sure which one? compare all templates on live data and auto-pick */}
        <div className="mt-3">
          <BestStrategyFinder
            market={marketValid ? market : TEMPLATE_CONFIG[tpl].market}
            disabled={pending}
            onPick={(t) => pickTemplate(t)}
          />
        </div>
      </section>

      {/* 2 · config + live preview */}
      <section className="overflow-hidden card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="eyebrow">02 · {meta.label} - config &amp; preview</h2>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              ariaLabel="Market"
              value={marketSel}
              onChange={setMarketSel}
              options={[
                ...MARKETS.map((m) => ({ value: m, label: marketLabel(m) })),
                { value: CUSTOM_MARKET, label: "Custom…" },
              ]}
            />
            {marketSel === CUSTOM_MARKET && (
              <input
                value={customMarket}
                onChange={(e) => setCustomMarket(e.target.value)}
                placeholder="I-BTC_INR"
                aria-label="Custom market id"
                className="w-32 rounded-md border border-line bg-inset px-2.5 py-1.5 font-mono text-xs uppercase text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            )}
            <button
              type="button"
              disabled={pending || !marketValid || !!ruleErr}
              onClick={() =>
                run(
                  async () => {
                    const fd = new FormData();
                    fd.set("template", tpl);
                    fd.set("market", market);
                    if (customised) fd.set("params", JSON.stringify(diffs));
                    await addStrategyAction(fd);
                  },
                  `Added ${meta.label} on ${marketLabel(market)}`,
                )
              }
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Spinner className="h-4 w-4" />}
              Add strategy
            </button>
          </div>
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
            {(EXPERIMENTAL_TEMPLATES as readonly string[]).includes(tpl) ? (
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

      {/* 3 · your strategies */}
      <section className="card">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="eyebrow">03 · Your strategies</h2>
          <span className="font-mono text-[11px] text-faint">
            {strategies.filter((s) => s.enabled).length} active · no cap
          </span>
        </div>
        {strategies.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No strategies yet. Pick a template above, preview it, and add it.
          </div>
        ) : (
          <ul>
            {strategies.map((s) => {
              const enabled = !!s.enabled;
              const def =
                s.template === "custom" ? parseCustomDef(s.params) : null;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
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
                          · {def.rules.map(describeRule).join(" AND ")} · exits:{" "}
                          {describeExits(def.exits)}
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
        )}
      </section>
    </div>
  );
}
