"use client";
// Strategy picker + manager. Templates are chosen from cards (not a raw dropdown);
// the selected template shows its full config (entry rule, exit rule, parameters)
// and a live preview chart of simulated entries/exits before the user adds it.
import { useState, useTransition } from "react";
import { addStrategyAction, toggleStrategyAction, removeStrategyAction } from "@/app/actions";
import type { StrategyRow } from "@/lib/queries";
import type { Template } from "@/lib/entitlements";
import { STRATEGY_META, strategyLabel } from "@/lib/strategies";
import { TEMPLATE_CONFIG } from "@/lib/strategy-sim";
import { StrategyPreview } from "@/components/StrategyPreview";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const MARKETS = ["I-BTC_INR", "I-ETH_INR", "I-SOL_INR", "I-XRP_INR", "I-BNB_INR", "I-DOGE_INR"];
const CUSTOM = "__custom__";

const marketLabel = (m: string) => m.replace(/^I-/, "").replace("_", "/");

function ConfigRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-mono text-xs tabular-nums text-dim">{v}</dd>
    </div>
  );
}

export function StrategyManager({ allowed, strategies }: {
  allowed: string[]; strategies: StrategyRow[];
}) {
  const templates = allowed as Template[];
  const [pending, start] = useTransition();
  const [tpl, setTpl] = useState<Template>(templates[0] ?? "ma_crossover");
  const [marketSel, setMarketSel] = useState<string>(TEMPLATE_CONFIG[templates[0] ?? "ma_crossover"]?.market ?? MARKETS[0]);
  const [customMarket, setCustomMarket] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const meta = STRATEGY_META[tpl];
  const cfg = TEMPLATE_CONFIG[tpl];
  const market = marketSel === CUSTOM ? customMarket.trim().toUpperCase() : marketSel;
  const marketValid = /^[A-Z0-9_-]{3,24}$/.test(market);

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

  function pickTemplate(t: Template) {
    setTpl(t);
    if (marketSel !== CUSTOM) setMarketSel(TEMPLATE_CONFIG[t].market);
  }

  const exits = cfg.exits;
  const exitRows: [string, string][] = [
    ["Hard stop", `-${(exits.stopLossPct * 100).toFixed(1)}%`],
    ["Take-profit", exits.takeProfitPct > 0 ? `+${(exits.takeProfitPct * 100).toFixed(1)}%` : "none (let it run)"],
    ["ATR trail", exits.chandelierK > 0 ? `${exits.chandelierK}× ATR(${exits.atrPeriod}) off the peak` : "none"],
    ["Time-stop", exits.maxHoldBars > 0 ? `${exits.maxHoldBars} bars` : "none"],
  ];

  return (
    <div className="space-y-6">
      {/* 1 · pick a template */}
      <section>
        <h2 className="eyebrow mb-3">01 · Pick a template</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Strategy template">
          {templates.map((t) => {
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
                  "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "border-accent bg-panel ring-1 ring-accent/30" : "border-line bg-panel hover:border-faint",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${active ? "text-fg" : "text-dim"}`}>{m.label}</span>
                  <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                    {m.kind}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.blurb}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2 · config + live preview */}
      <section className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="eyebrow">02 · {meta.label} — config &amp; preview</h2>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              ariaLabel="Market"
              value={marketSel}
              onChange={setMarketSel}
              options={[...MARKETS.map((m) => ({ value: m, label: marketLabel(m) })), { value: CUSTOM, label: "Custom…" }]}
            />
            {marketSel === CUSTOM && (
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
              disabled={pending || !marketValid}
              onClick={() => run(async () => {
                const fd = new FormData(); fd.set("template", tpl); fd.set("market", market);
                await addStrategyAction(fd);
              }, `Added ${meta.label} on ${marketLabel(market)}`)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Spinner className="h-4 w-4" />}
              Add strategy
            </button>
          </div>
        </div>

        {err && <p role="alert" className="border-b border-line px-4 py-2 text-sm text-loss">{err}</p>}

        <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
          {/* config sidebar */}
          <div className="space-y-4 border-b border-line p-4 lg:border-b-0 lg:border-r">
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">Enters when</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">{meta.entry}</p>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">Exits via</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">{meta.exit}</p>
              <dl className="mt-2 divide-y divide-line/60 rounded-md border border-line bg-inset px-3 py-1">
                {exitRows.map(([k, v]) => <ConfigRow key={k} k={k} v={v} />)}
              </dl>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">Stock parameters</h3>
              <dl className="mt-2 divide-y divide-line/60 rounded-md border border-line bg-inset px-3 py-1">
                {cfg.paramLabels.map(([key, label]) => (
                  <ConfigRow key={key} k={label} v={String(cfg.params[key])} />
                ))}
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Parameters are the backtested stock values the engine runs - shown here so you know
                exactly what you&rsquo;re enabling.
              </p>
            </div>
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">Style</h3>
              <p className="mt-1 text-xs leading-relaxed text-dim">{meta.style}</p>
            </div>
          </div>

          {/* live preview */}
          <div className="p-4">
            {marketValid ? (
              <StrategyPreview template={tpl} market={market} />
            ) : (
              <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line text-sm text-muted">
                Enter a market id (e.g. I-BTC_INR) to preview.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3 · your strategies */}
      <section className="rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
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
          <ul className="divide-y divide-line/70">
            {strategies.map((s) => {
              const enabled = !!s.enabled;
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{strategyLabel(s.template)}</span>
                      <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] font-medium text-dim">
                        {s.market}
                      </span>
                      <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
                        {STRATEGY_META[s.template as Template]?.kind ?? "custom"}
                      </span>
                      {s.params && (
                        <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                          custom params
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <span className={["h-1.5 w-1.5 rounded-full", enabled ? "bg-gain" : "bg-faint"].join(" ")} />
                      {enabled ? "Enabled" : "Disabled"}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => toggleStrategyAction(s.id, !s.enabled), enabled ? "Strategy disabled" : "Strategy enabled")}
                      className={[
                        "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
                        enabled
                          ? "border-line text-dim hover:bg-inset"
                          : "border-gain/50 text-gain hover:bg-gain/10",
                      ].join(" ")}
                    >
                      {enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Remove ${strategyLabel(s.template)} on ${s.market}? This can't be undone.`)) return;
                        run(() => removeStrategyAction(s.id), "Strategy removed");
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
