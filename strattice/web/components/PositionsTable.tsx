"use client";
import { useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { strategyLabel } from "@/lib/strategies";
import { fmt } from "@/lib/dashboard-format";

export interface Position {
  strategy: string;
  market: string;
  qty: number;
  avg_price: number;
}

type SortKey = "strategy" | "market" | "qty" | "avg_price" | "value";
const prettyMarket = (m: string) => m.replace(/^I-/, "").replace("_", "/");

function Th({
  label,
  col,
  sort,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  col: SortKey;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (c: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort === col;
  return (
    <th
      className={[
        "px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-wider",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={[
          "inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          align === "right" ? "flex-row-reverse" : "",
          active ? "text-dim" : "text-faint hover:text-muted",
        ].join(" ")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px] leading-none">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function PositionsTable({ positions }: { positions: Position[] }) {
  const [query, setQuery] = useState("");
  const [strategy, setStrategy] = useState("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const strategyOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of positions) seen.set(p.strategy, strategyLabel(p.strategy));
    return [
      { value: "all", label: "All strategies" },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [positions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = positions.filter((p) => {
      if (strategy !== "all" && p.strategy !== strategy) return false;
      if (!q) return true;
      return (
        strategyLabel(p.strategy).toLowerCase().includes(q) ||
        p.market.toLowerCase().includes(q) ||
        prettyMarket(p.market).toLowerCase().includes(q)
      );
    });
    const val = (p: Position, k: SortKey) =>
      k === "value" ? p.qty * p.avg_price : k === "strategy" ? strategyLabel(p.strategy) : p[k];
    return filtered.sort((a, b) => {
      const av = val(a, sort);
      const bv = val(b, sort);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [positions, query, strategy, sort, dir]);

  function onSort(c: SortKey) {
    if (c === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(c);
      setDir(c === "strategy" || c === "market" ? "asc" : "desc");
    }
  }

  return (
    <section className="card" id="positions">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Open positions{" "}
          <span className="font-mono text-[11px] font-normal text-faint">
            {rows.length}
          </span>
        </h3>
        {positions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search market or strategy"
              className="w-48 rounded-md border border-line bg-inset px-3 py-1.5 text-xs text-fg placeholder:text-faint transition-colors hover:border-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Search positions"
            />
            {strategyOptions.length > 2 && (
              <Select
                size="sm"
                value={strategy}
                onChange={setStrategy}
                options={strategyOptions}
                ariaLabel="Filter by strategy"
                className="w-40"
              />
            )}
          </div>
        )}
      </div>

      {positions.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No open positions.</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No positions match your search.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse">
            <thead>
              <tr className="bg-white/[0.03]">
                <Th label="Strategy" col="strategy" sort={sort} dir={dir} onSort={onSort} />
                <Th label="Market" col="market" sort={sort} dir={dir} onSort={onSort} />
                <Th label="Qty" col="qty" sort={sort} dir={dir} onSort={onSort} align="right" />
                <Th label="Avg price" col="avg_price" sort={sort} dir={dir} onSort={onSort} align="right" />
                <Th label="Value" col="value" sort={sort} dir={dir} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr
                  key={`${p.strategy}-${p.market}-${i}`}
                  className="transition-colors hover:bg-inset/60"
                >
                  <td className="px-4 py-2.5 text-sm text-fg">
                    {strategyLabel(p.strategy)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted">
                    {prettyMarket(p.market)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm tnum text-dim">
                    {fmt(p.qty)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm tnum text-dim">
                    {fmt(p.avg_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm tnum text-fg">
                    {fmt(p.qty * p.avg_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
