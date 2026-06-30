"use client";
import { useState, useTransition } from "react";
import { addStrategyAction, toggleStrategyAction, removeStrategyAction } from "@/app/actions";
import type { StrategyRow } from "@/lib/queries";

const DEFAULT_MARKET: Record<string, string> = {
  ma_crossover: "I-BTC_INR", rsi: "I-ETH_INR", momentum: "I-BTC_INR",
  vol_expansion: "I-XRP_INR", fast_rsi: "I-BNB_INR", bb_reversion: "I-SOL_INR",
  squeeze_breakout: "I-DOGE_INR",
};

export function StrategyManager({ allowed, maxActive, strategies }: {
  allowed: string[]; maxActive: number | null; strategies: StrategyRow[];
}) {
  const [pending, start] = useTransition();
  const [tpl, setTpl] = useState(allowed[0] ?? "");
  const [market, setMarket] = useState(DEFAULT_MARKET[allowed[0] ?? ""] ?? "");
  const [err, setErr] = useState<string | null>(null);
  const enabledCount = strategies.filter((s) => s.enabled).length;
  const atCap = maxActive !== null && enabledCount >= maxActive;

  function run(fn: () => Promise<void>) {
    setErr(null);
    start(async () => { try { await fn(); } catch (e: any) { setErr(e.message ?? "Failed"); } });
  }

  return (
    <div className="rounded-lg border border-line bg-panel">
      {/* Add row */}
      <div className="border-b border-line p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="sm-template" className="block font-mono text-[11px] font-medium uppercase tracking-wider text-faint">
              Strategy template
            </label>
            <select
              id="sm-template"
              value={tpl}
              onChange={(e) => { setTpl(e.target.value); setMarket(DEFAULT_MARKET[e.target.value] ?? ""); }}
              className="w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {allowed.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex-1 space-y-1.5">
            <label htmlFor="sm-market" className="block font-mono text-[11px] font-medium uppercase tracking-wider text-faint">
              Market
            </label>
            <input
              id="sm-market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              placeholder="I-BTC_INR"
              className="w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-sm uppercase text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <button
            type="button"
            disabled={pending || !tpl || !market.trim()}
            onClick={() => run(async () => {
              const fd = new FormData(); fd.set("template", tpl); fd.set("market", market);
              await addStrategyAction(fd);
            })}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">
            Active{" "}
            <span className={atCap ? "font-mono font-medium text-warn" : "font-mono font-medium text-dim"}>
              {enabledCount}{maxActive !== null ? ` / ${maxActive}` : " / ∞"}
            </span>
          </span>
          {atCap && (
            <span className="rounded-sm border border-warn/30 bg-warn/10 px-2 py-0.5 text-xs text-warn">
              At plan cap — disable one or upgrade to enable more.
            </span>
          )}
        </div>

        {err && <p role="alert" className="mt-2 text-sm text-loss">{err}</p>}
      </div>

      {/* List */}
      {strategies.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted">
          No strategies yet. Add one above to get started.
        </div>
      ) : (
        <ul className="divide-y divide-line/70">
          {strategies.map((s) => {
            const enabled = !!s.enabled;
            const blockEnable = !enabled && atCap;
            return (
              <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{s.template}</span>
                    <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] font-medium text-dim">
                      {s.market}
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
                    disabled={pending || blockEnable}
                    onClick={() => run(() => toggleStrategyAction(s.id, !s.enabled))}
                    className={[
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      enabled
                        ? "border-line text-dim hover:bg-inset"
                        : "border-gain/50 text-gain hover:bg-gain/10",
                      blockEnable ? "cursor-not-allowed opacity-40" : "",
                    ].join(" ")}
                    title={blockEnable ? "At plan cap" : undefined}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeStrategyAction(s.id))}
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
    </div>
  );
}
