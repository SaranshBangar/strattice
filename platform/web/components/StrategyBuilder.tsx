"use client";
// The strategy builder: compose entry conditions from indicator blocks, configure the
// protective exits, and watch the strategy trade - every edit re-simulates instantly on
// live candles (chart with entries/exits) and across four history windows (the analysis
// table), plus a head-to-head against the stock templates on the same market.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStrategyAction } from "@/app/actions";
import { BUILTIN_TEMPLATES } from "@/lib/entitlements";
import { STRATEGY_META } from "@/lib/strategies";
import { simulate, FRICTION_PCT, type Candle, type SimResult } from "@/lib/strategy-sim";
import {
  RULE_CATALOG, RULE_SPEC, newRule, defaultCustomDef, describeRule, describeExits,
  sanitizeCustomDef, simulateCustom, EXIT_FIELDS, MAX_RULES,
  type CustomDef, type Rule, type NumField, type RuleField,
} from "@/lib/custom-strategy";
import { StrategyPreview } from "@/components/StrategyPreview";
import { MARKETS } from "@/components/StrategyManager";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const marketLabel = (m: string) => m.replace(/^I-/, "").replace("_", "/");
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// Exit fields whose stored value is a fraction but whose UI unit is %.
const PCT_EXIT_KEYS = new Set(["stop_loss_pct", "take_profit_pct"]);

const WINDOWS: Record<string, string> = { "15m": "≈ 5 days", "1h": "≈ 3 weeks", "4h": "≈ 12 weeks", "1d": "≈ 16 months" };

function NumInput({ field, value, onChange, id }: {
  field: NumField; value: number; onChange: (v: number) => void; id: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(field.int ? Math.round(n) : n);
        }}
        aria-label={field.label}
        className="w-20 rounded-md border border-line bg-inset px-2 py-1 text-right font-mono text-xs tabular-nums text-fg focus:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
      {field.unit && <span className="font-mono text-[10px] text-faint">{field.unit}</span>}
    </span>
  );
}

function RuleCard({ rule, onChange, onRemove }: {
  rule: Rule; onChange: (r: Rule) => void; onRemove: () => void;
}) {
  const spec = RULE_SPEC[rule.kind];
  if (!spec) return null;
  return (
    <div className="rounded-lg bg-inset p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-fg">{spec.label}</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{spec.blurb}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${spec.label}`}
          className="rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-loss focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-loss"
        >
          ✕
        </button>
      </div>
      {spec.fields.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {spec.fields.map((f: RuleField) => (
            <label key={f.key} className="flex items-center gap-1.5 text-[11px] text-muted">
              {f.label}
              {f.t === "enum" ? (
                <Select
                  size="sm"
                  ariaLabel={f.label}
                  value={String(rule[f.key])}
                  onChange={(v) => onChange({ ...rule, [f.key]: v })}
                  options={f.options}
                />
              ) : (
                <NumInput
                  id={`${rule.kind}-${f.key}`}
                  field={f}
                  value={Number(rule[f.key])}
                  onChange={(v) => onChange({ ...rule, [f.key]: v })}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <p className="mt-2 pt-2 font-mono text-[11px] text-accent">
        → {describeRule(rule)}
      </p>
    </div>
  );
}

/** Fetches candles for every window of a market, once, and caches them. */
function useWindows(market: string) {
  const [data, setData] = useState<Record<string, Candle[]>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData({});
    (async () => {
      const out: Record<string, Candle[]> = {};
      await Promise.all(Object.keys(WINDOWS).map(async (iv) => {
        try {
          const r = await fetch(`/api/candles?pair=${encodeURIComponent(market)}&interval=${iv}&limit=500`);
          const j = await r.json();
          if (r.ok && Array.isArray(j.candles) && j.candles.length >= 10) out[iv] = j.candles;
        } catch { /* window stays absent; the table shows a dash */ }
      }));
      if (alive) { setData(out); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [market]);
  return { windows: data, loading };
}

export function StrategyBuilder() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [def, setDef] = useState<CustomDef>(defaultCustomDef);
  const [market, setMarket] = useState<string>(MARKETS[0]);
  const [addOpen, setAddOpen] = useState(false);
  const [compareIv, setCompareIv] = useState("1h");
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addOpen]);

  // Live validation: the same sanitizer the server runs. Valid def -> preview + save on.
  const { cleanDef, defErr } = useMemo(() => {
    try {
      return { cleanDef: sanitizeCustomDef(def as unknown), defErr: null as string | null };
    } catch (e: any) {
      return { cleanDef: null, defErr: String(e.message ?? e) };
    }
  }, [def]);

  const { windows, loading: windowsLoading } = useWindows(market);

  // Historic analysis: your strategy across every window.
  const historic = useMemo(() => {
    if (!cleanDef) return [];
    return Object.keys(WINDOWS).map((iv) => {
      const candles = windows[iv];
      return { iv, span: WINDOWS[iv], sim: candles ? simulateCustom(cleanDef, candles) : null };
    });
  }, [cleanDef, windows]);

  // Head-to-head: you vs the stock templates, same market + window.
  const compare = useMemo(() => {
    const candles = windows[compareIv];
    if (!candles || !cleanDef) return [];
    const rows: { name: string; you?: boolean; sim: SimResult }[] = [
      { name: cleanDef.name, you: true, sim: simulateCustom(cleanDef, candles) },
      ...BUILTIN_TEMPLATES.map((t) => ({ name: STRATEGY_META[t].label, sim: simulate(t, candles) })),
    ];
    return rows.sort((a, b) => b.sim.totalNetPct - a.sim.totalNetPct);
  }, [cleanDef, windows, compareIv]);

  function save() {
    if (!cleanDef) return;
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("template", "custom");
        fd.set("market", market);
        fd.set("params", JSON.stringify(cleanDef));
        await addStrategyAction(fd);
        toast(`Saved "${cleanDef.name}" on ${marketLabel(market)}`, "success");
        router.push("/strategies");
      } catch (e: any) {
        toast(e.message ?? "Couldn't save. Please try again.", "error");
      }
    });
  }

  const setExit = (key: string, v: number) =>
    setDef((d) => ({ ...d, exits: { ...d.exits, [key]: PCT_EXIT_KEYS.has(key) ? v / 100 : v } }));

  return (
    <div className="space-y-4">
      {/* header: name + market + save */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={def.name}
          onChange={(e) => setDef((d) => ({ ...d, name: e.target.value.slice(0, 60) }))}
          placeholder="Name your strategy"
          aria-label="Strategy name"
          className="min-w-48 flex-1 rounded-md bg-white/5 px-3 py-2 font-display text-base font-semibold tracking-tight text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Select
          ariaLabel="Market"
          value={market}
          onChange={setMarket}
          options={MARKETS.map((m) => ({ value: m, label: marketLabel(m) }))}
        />
        <button
          type="button"
          disabled={pending || !cleanDef}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && <Spinner className="h-4 w-4" />}
          Save strategy
        </button>
      </div>

      {defErr && <p role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{defErr}</p>}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---- left: the builder ---- */}
        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="eyebrow">Entry conditions - all must be true</h2>
              <span className="font-mono text-[11px] text-faint">{def.rules.length}/{MAX_RULES}</span>
            </div>
            <div className="space-y-2 p-3">
              {def.rules.map((r, i) => (
                <RuleCard
                  key={i}
                  rule={r}
                  onChange={(nr) => setDef((d) => ({ ...d, rules: d.rules.map((x, j) => (j === i ? nr : x)) }))}
                  onRemove={() => setDef((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))}
                />
              ))}
              {def.rules.length === 0 && (
                <p className="px-1 py-3 text-center text-xs text-muted">No conditions yet - add one below.</p>
              )}

              {/* add-condition menu */}
              <div className="relative" ref={addRef}>
                <button
                  type="button"
                  disabled={def.rules.length >= MAX_RULES}
                  onClick={() => setAddOpen((v) => !v)}
                  aria-expanded={addOpen}
                  className="w-full rounded-md border border-dashed border-accent/50 px-3 py-2 text-sm font-medium text-accent transition-colors hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add condition
                </button>
                {addOpen && (
                  <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md bg-white/5 py-1 shadow-xl shadow-black/40" role="menu">
                    {RULE_CATALOG.map((spec) => (
                      <li key={spec.kind} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setDef((d) => ({ ...d, rules: [...d.rules, newRule(spec.kind)] })); setAddOpen(false); }}
                          className="w-full px-3 py-2 text-left transition-colors hover:bg-inset focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        >
                          <span className="block text-xs font-medium text-fg">{spec.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{spec.blurb}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="px-4 py-3">
              <h2 className="eyebrow">Exits - how every trade ends</h2>
            </div>
            <div className="space-y-1 p-3">
              {EXIT_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 py-1">
                  <label htmlFor={`ex-${f.key}`} className="text-xs text-muted">{f.label}</label>
                  <NumInput
                    id={`ex-${f.key}`}
                    field={f}
                    value={PCT_EXIT_KEYS.has(f.key) ? Number((def.exits[f.key as keyof typeof def.exits] * 100).toFixed(4)) : def.exits[f.key as keyof typeof def.exits]}
                    onChange={(v) => setExit(f.key, v)}
                  />
                </div>
              ))}
              <p className="pt-2 text-[11px] leading-relaxed text-faint">
                The hard stop is mandatory - it caps the worst case. Add a take-profit, trail or
                time-stop so winners and stalled trades also have a way out.
              </p>
            </div>
          </section>

          {/* plain-English summary */}
          {cleanDef && (
            <section className="rounded-lg border border-accent/40 bg-panel p-4">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-accent">Your strategy, in plain English</h2>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                <span className="font-medium text-gain">BUY</span> {marketLabel(market)} when{" "}
                {cleanDef.rules.map((r, i) => (
                  <span key={i}>
                    {i > 0 && <span className="font-mono text-[10px] text-faint"> AND </span>}
                    {describeRule(r)}
                  </span>
                ))}
                . <span className="font-medium text-loss">EXIT</span> via {describeExits(cleanDef.exits)}.
              </p>
            </section>
          )}
        </div>

        {/* ---- right: live preview + analysis ---- */}
        <div className="space-y-4">
          <section className="card p-4">
            {cleanDef ? (
              <StrategyPreview custom={cleanDef} market={market} />
            ) : (
              <div className="grid h-[300px] place-items-center rounded-md border border-dashed border-line px-6 text-center text-sm text-muted">
                {defErr ?? "Fix the strategy definition to see the preview."}
              </div>
            )}
          </section>

          {/* historic analysis across windows */}
          <section className="overflow-hidden card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="eyebrow">Historic analysis - every window, net of fees</h2>
              {windowsLoading && <Spinner className="h-4 w-4" />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-inset text-faint">
                  <tr>
                    <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Window</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Entries</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Win rate</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Net</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Buy &amp; hold</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Exposure</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.015]">
                  {historic.map(({ iv, span, sim }) => (
                    <tr key={iv}>
                      <td className="px-3 py-1.5 text-dim">{iv} <span className="text-faint">· {span}</span></td>
                      {sim ? (
                        <>
                          <td className="px-3 py-1.5 text-right tnum text-dim">{sim.trades.length}</td>
                          <td className="px-3 py-1.5 text-right tnum text-dim">{sim.winRate === null ? "-" : `${sim.winRate.toFixed(0)}%`}</td>
                          <td className={`px-3 py-1.5 text-right tnum ${sim.closed === 0 ? "text-muted" : sim.totalNetPct >= 0 ? "text-gain" : "text-loss"}`}>
                            {sim.closed ? pct(sim.totalNetPct) : "-"}
                          </td>
                          <td className={`px-3 py-1.5 text-right tnum ${sim.buyHoldPct >= 0 ? "text-gain" : "text-loss"}`}>{pct(sim.buyHoldPct)}</td>
                          <td className="px-3 py-1.5 text-right tnum text-muted">{sim.exposurePct.toFixed(0)}%</td>
                        </>
                      ) : (
                        <td colSpan={5} className="px-3 py-1.5 text-faint">{windowsLoading ? "loading…" : "no data"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* head-to-head vs the stock templates */}
          <section className="overflow-hidden card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <h2 className="eyebrow">Vs the stock templates - same market &amp; window</h2>
              <Select
                size="sm"
                ariaLabel="Comparison window"
                value={compareIv}
                onChange={setCompareIv}
                options={Object.keys(WINDOWS).map((k) => ({ value: k, label: `${k} · ${WINDOWS[k]}` }))}
              />
            </div>
            {compare.length ? (
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-inset text-faint">
                  <tr>
                    <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Strategy</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Entries</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Win rate</th>
                    <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wider">Net</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.015]">
                  {compare.map((row) => (
                    <tr key={row.name} className={row.you ? "bg-accent/5" : ""}>
                      <td className="px-3 py-1.5 text-dim">
                        {row.you && <span className="mr-1.5 rounded-sm bg-accent/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">you</span>}
                        {row.name}
                      </td>
                      <td className="px-3 py-1.5 text-right tnum text-dim">{row.sim.trades.length}</td>
                      <td className="px-3 py-1.5 text-right tnum text-dim">{row.sim.winRate === null ? "-" : `${row.sim.winRate.toFixed(0)}%`}</td>
                      <td className={`px-3 py-1.5 text-right tnum ${row.sim.closed === 0 ? "text-muted" : row.sim.totalNetPct >= 0 ? "text-gain" : "text-loss"}`}>
                        {row.sim.closed ? pct(row.sim.totalNetPct) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-muted">{windowsLoading ? "Loading candles…" : "No data for this window."}</p>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-faint">
            All numbers are simulated on public CoinDCX candles, fills at bar close, long-only, net of
            ~{FRICTION_PCT}% round-trip friction (fee + GST + TDS). A strategy that only wins on one
            window is probably fit to noise - look for consistency. Past performance never guarantees
            future results; start in DRY_RUN.
          </p>
        </div>
      </div>
    </div>
  );
}
