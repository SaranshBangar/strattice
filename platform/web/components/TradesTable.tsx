"use client";
// Trade history with client-side search, filtering, sorting, pagination and CSV
// export. The server passes a bounded window of rows (see dashboard) and all
// interaction happens here — instant, no round-trips.
import { useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { strategyLabel } from "@/lib/strategies";

export interface Trade {
  strategy: string;
  market: string;
  side: string;
  qty: number;
  price: number;
  notional: number;
  status: string;
  realized_pnl: number;
  tds: number;
  dry_run?: number;
  ts: string;
}

type SortKey = "ts" | "market" | "qty" | "price" | "notional" | "realized_pnl";
const PAGE_SIZES = [10, 25, 50, 100];

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtTs = (ts: string) => ts?.slice(0, 19).replace("T", " ") ?? "";

export function TradesTable({ trades }: { trades: Trade[] }) {
  const [search, setSearch] = useState("");
  const [strategy, setStrategy] = useState("all");
  const [side, setSide] = useState("all");
  const [mode, setMode] = useState("all");
  const [sort, setSort] = useState<SortKey>("ts");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const strategies = useMemo(
    () => Array.from(new Set(trades.map((t) => t.strategy))).sort(),
    [trades],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = trades.filter((t) => {
      if (strategy !== "all" && t.strategy !== strategy) return false;
      if (side !== "all" && t.side?.toLowerCase() !== side) return false;
      if (mode === "live" && t.dry_run) return false;
      if (mode === "paper" && !t.dry_run) return false;
      if (q && !(`${t.market} ${strategyLabel(t.strategy)} ${t.side} ${t.status}`.toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [trades, search, strategy, side, sort, dir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir(key === "market" ? "asc" : "desc"); }
    setPage(1);
  }

  function exportCsv() {
    const head = ["time", "strategy", "market", "side", "qty", "price", "notional", "status", "realized_pnl", "tds", "mode"];
    const lines = filtered.map((t) =>
      [fmtTs(t.ts), t.strategy, t.market, t.side, t.qty, t.price, t.notional, t.status, t.realized_pnl, t.tds, t.dry_run ? "DRY_RUN" : "LIVE"]
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
          Trade history
          <span className="ml-2 font-mono text-xs font-normal text-faint">{filtered.length}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="9" cy="9" r="6" />
              <path strokeLinecap="round" d="m17 17-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search market, strategy…"
              aria-label="Search trades"
              className="w-full rounded-md border border-line bg-inset py-1.5 pl-8 pr-3 text-xs text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-52"
            />
          </div>
          <Select
            size="sm"
            ariaLabel="Filter by strategy"
            value={strategy}
            onChange={resetPage(setStrategy)}
            options={[{ value: "all", label: "All strategies" }, ...strategies.map((s) => ({ value: s, label: strategyLabel(s) }))]}
          />
          <Select
            size="sm"
            ariaLabel="Filter by side"
            value={side}
            onChange={resetPage(setSide)}
            options={[{ value: "all", label: "Both sides" }, { value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]}
          />
          <Select
            size="sm"
            ariaLabel="Filter by mode"
            value={mode}
            onChange={resetPage(setMode)}
            options={[{ value: "all", label: "Live + paper" }, { value: "live", label: "Live only" }, { value: "paper", label: "Paper only" }]}
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted">No trades match your filters.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <Th onClick={() => toggleSort("ts")} active={sort === "ts"} dir={dir}>Time</Th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint">Strategy</th>
                  <Th onClick={() => toggleSort("market")} active={sort === "market"} dir={dir}>Market</Th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint">Side</th>
                  <Th onClick={() => toggleSort("qty")} active={sort === "qty"} dir={dir} align="right">Qty</Th>
                  <Th onClick={() => toggleSort("price")} active={sort === "price"} dir={dir} align="right">Price</Th>
                  <Th onClick={() => toggleSort("notional")} active={sort === "notional"} dir={dir} align="right">Notional</Th>
                  <Th onClick={() => toggleSort("realized_pnl")} active={sort === "realized_pnl"} dir={dir} align="right">P&amp;L</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t, i) => {
                  const buy = t.side?.toLowerCase() === "buy";
                  const p = t.realized_pnl;
                  const executed = t.status === "placed" || t.status === "dry_run";
                  return (
                    <tr key={i} className={["border-b border-line/60 last:border-0 hover:bg-inset/60", executed ? "" : "opacity-60"].join(" ")}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono tnum text-muted">{fmtTs(t.ts)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium text-fg">
                        {strategyLabel(t.strategy)}
                        {t.dry_run ? <span className="ml-1.5 rounded-sm bg-inset px-1 py-0.5 text-[9px] uppercase tracking-wide text-faint">dry</span> : null}
                        {!executed && <span className="ml-1.5 rounded-sm bg-loss/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-loss">{t.status}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-dim">{t.market}</td>
                      <td className={["whitespace-nowrap px-4 py-2.5 font-mono", buy ? "text-gain" : "text-loss"].join(" ")}>{t.side?.toUpperCase()}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tnum text-dim">{fmt(t.qty)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tnum text-dim">{fmt(t.price)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tnum text-dim">{fmt(t.notional)}</td>
                      <td className={["whitespace-nowrap px-4 py-2.5 text-right font-mono tnum", p < 0 ? "text-loss" : p > 0 ? "text-gain" : "text-muted"].join(" ")}>
                        {p > 0 ? "+" : ""}{fmt(p)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>Rows</span>
              <Select
                size="sm"
                ariaLabel="Rows per page"
                value={String(pageSize)}
                onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
              />
              <span className="tabular-nums">
                {start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <PageBtn disabled={clampedPage <= 1} onClick={() => setPage(1)}>«</PageBtn>
              <PageBtn disabled={clampedPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</PageBtn>
              <span className="px-2 font-mono text-xs tabular-nums text-dim">{clampedPage} / {totalPages}</span>
              <PageBtn disabled={clampedPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</PageBtn>
              <PageBtn disabled={clampedPage >= totalPages} onClick={() => setPage(totalPages)}>»</PageBtn>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Th({ children, onClick, active, dir, align = "left" }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc"; align?: "left" | "right" }) {
  return (
    <th className={["whitespace-nowrap px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em]", align === "right" ? "text-right" : "text-left"].join(" ")}>
      <button
        type="button"
        onClick={onClick}
        className={["inline-flex items-center gap-1 transition-colors hover:text-dim focus-visible:outline-none", active ? "text-accent" : "text-faint", align === "right" ? "flex-row-reverse" : ""].join(" ")}
      >
        {children}
        <span className="text-[8px]">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function PageBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-dim transition-colors hover:bg-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
