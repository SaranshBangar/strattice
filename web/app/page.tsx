"use client";
import { useEffect, useRef, useState } from "react";
import MarketChart from "../components/MarketChart";

type Strat = { name: string; market: string; enabled: boolean };
type Pos = { strategy: string; market: string; qty: number; avg_price: number };
type Trade = { ts: string; market: string; side: string; qty: number; price: number; status: string; dry_run: number; realized_pnl: number };
type Signal = { ts: string; strategy: string; market: string; action: string; price: number; meta: string };
type Status = {
  mode: string; quote: string; inr_per_usdt: number | null; equity_basis: string; kill_switch: boolean;
  equity: number; free: number; trades_today: number; max_trades_per_day: number;
  realized_today: number; loss_limit: number; tds_today: number;
  capital_at_risk: number; cap_ceiling: number; total_realized: number;
  strategies: Strat[]; positions: Pos[]; trades: Trade[]; signals: Signal[];
};

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const mkt = (m: string) => m.replace("I-", "").replace("_INR", "");
// Bot stores ts as UTC ISO (+00:00), so Date parses it right — render in IST.
const ts = (t: string) =>
  new Date(t).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

export default function Dashboard() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  // Track last-seen counts to spot new trades/positions between polls (skip first load).
  const seen = useRef<{ trades: number; positions: number } | null>(null);

  function toast(msg: string, kind = "") {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  async function load() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const data: Status = await r.json();
      setS(data);
      setErr("");
      // toast on new trade / opened position (count went up since last poll)
      if (seen.current) {
        if (data.trades.length > seen.current.trades) {
          const t = data.trades[0];
          toast(`Trade executed: ${t.side.toUpperCase()} ${mkt(t.market)}`, "good");
        }
        if (data.positions.length > seen.current.positions) toast("Position opened", "good");
      }
      seen.current = { trades: data.trades.length, positions: data.positions.length };
      // fetch last price per held market for unrealized P&L
      const held = [...new Set(data.positions.map((p) => p.market))];
      const entries = await Promise.all(
        held.map(async (m) => {
          const c = await fetch(`/api/candles?pair=${m}&interval=15m&limit=1`).then((r) => r.json());
          return [m, Array.isArray(c) && c[0] ? c[0].close : 0] as const;
        })
      );
      setPrices(Object.fromEntries(entries));
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  // Optimistic toggle: flip locally now, POST, revert + surface error on failure.
  // /api/status re-reads config.yaml each poll, so the next load() confirms server truth.
  async function toggle(name: string, enabled: boolean) {
    setS((cur) =>
      cur ? { ...cur, strategies: cur.strategies.map((g) => (g.name === name ? { ...g, enabled } : g)) } : cur
    );
    try {
      const r = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      toast(`${name} turned ${enabled ? "on" : "off"}`, enabled ? "good" : "bad");
    } catch (e: any) {
      setErr(`toggle ${name}: ${e.message ?? e}`);
      setS((cur) =>
        cur ? { ...cur, strategies: cur.strategies.map((g) => (g.name === name ? { ...g, enabled: !enabled } : g)) } : cur
      );
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>Dashboard</h1>
        {s && <span className={`pill ${s.mode.toLowerCase().includes("live") ? "live" : "off"}`}>{s.mode}</span>}
        {s?.kill_switch && <span className="pill off">KILL</span>}
        <button className="refresh" onClick={load}>↻</button>
      </header>

      {err && <div className="card red" style={{ marginTop: 10 }}>{err}</div>}
      {!s && !err && <p className="center muted">loading…</p>}

      {s && (
        <>
          {/* P&L hero — the at-a-glance numbers */}
          <div className="hero">
            <Stat l="Equity" v={inr(s.equity)} />
            <Stat l="Free" v={inr(s.free)} />
            <Stat l="Today" v={inr(s.realized_today)} cls={s.realized_today >= 0 ? "green" : "red"} />
            <Stat l="Total P&L" v={inr(s.total_realized)} cls={s.total_realized >= 0 ? "green" : "red"} />
          </div>

          {/* Chart — centerpiece */}
          <MarketChart />

          <h2>Strategies ({s.strategies?.filter((g) => g.enabled).length ?? 0}/{s.strategies?.length ?? 0} on)</h2>
          <Strategies s={s} toggle={toggle} />

          <h2>Positions ({s.positions.length})</h2>
          <Positions s={s} prices={prices} />

          <h2>Trades ({s.trades.length})</h2>
          <Trades s={s} />

          <h2>Signals ({s.signals?.length ?? 0})</h2>
          <Signals s={s} />

          {/* Risk & limits — secondary, tucked at the bottom */}
          <h2>Risk &amp; limits</h2>
          <div className="card">
            <div className="grid">
              <Stat l="Loss limit" v={inr(s.loss_limit)} cls="red" />
              <Stat l="TDS today" v={inr(s.tds_today)} />
              <Stat l="At risk" v={`${inr(s.capital_at_risk)} / ${inr(s.cap_ceiling)}`} />
              <Stat l="Trades today" v={`${s.trades_today} / ${s.max_trades_per_day}`} />
              <Stat l="Quote" v={s.quote} />
              {s.inr_per_usdt != null && <Stat l="INR / USDT" v={inr(s.inr_per_usdt)} />}
            </div>
            <div className="row" style={{ marginTop: 8, borderBottom: 0 }}>
              <span className="sub">Equity basis</span>
              <span className="sub">{s.equity_basis}</span>
            </div>
          </div>
        </>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

// Plain-English blurb per strategy, keyed off the name prefix (modules: ma_crossover,
// rsi, momentum, vol_expansion). ponytail: name-prefix heuristic, not the bot's module
// field (status API doesn't return it); add a `module` to the API if names ever drift.
function describe(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("ma")) return "Moving-average crossover. Buys when a fast SMA crosses above a slow SMA and rides the trend; a hard stop and ATR trail handle the exit.";
  if (n.startsWith("rsi")) return "RSI mean-reversion. Buys oversold dips (RSI below threshold) inside an uptrend, expecting a bounce back toward the average; time-stop bails a stalled trade.";
  if (n.startsWith("breakout") || n.startsWith("mom")) return "Momentum breakout. Buys when price closes above its recent N-bar high (Donchian channel) and trails the move.";
  if (n.startsWith("vol")) return "Volatility expansion. Enters when the bar's range expands past the expected move, catching fresh bursts of momentum.";
  return "Algorithmic, entry-only strategy. Exits are handled by the shared stop-loss / take-profit / trail layer.";
}

function Strategies({ s, toggle }: { s: Status; toggle: (name: string, enabled: boolean) => void }) {
  const held = new Set(s.positions.map((p) => p.strategy));
  const rows = s.strategies ?? [];
  return (
    <div className="card">
      {rows.length === 0 && <p className="center muted" style={{ padding: 14 }}>No strategies</p>}
      {rows.map((g) => {
        const exitOnly = !g.enabled && held.has(g.name); // disabled but still managing an open position
        return (
          <details className="strat" key={g.name}>
            <summary>
              <div className="strat-main">
                <div>{g.name}</div>
                <div className="sub">
                  {mkt(g.market)}
                  {exitOnly && <span className="red"> · managing exit until flat</span>}
                </div>
              </div>
              {/* stop summary toggling when the switch is clicked */}
              <label className="sw" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => toggle(g.name, e.target.checked)}
                />
                <span className="track" />
              </label>
            </summary>
            <p className="sub strat-desc">{describe(g.name)}</p>
          </details>
        );
      })}
    </div>
  );
}

function Positions({ s, prices }: { s: Status; prices: Record<string, number> }) {
  return (
    <div className="card">
      {s.positions.length === 0 && <p className="center muted" style={{ padding: 14 }}>No open positions</p>}
      {s.positions.map((p, i) => {
        const px = prices[p.market];
        const pnl = px ? (px - p.avg_price) * p.qty : null;
        const pct = px ? ((px - p.avg_price) / p.avg_price) * 100 : null;
        return (
          <div className="row" key={i}>
            <div>
              <div>{mkt(p.market)}</div>
              <div className="sub">{p.strategy} · {p.qty} @ {inr(p.avg_price)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              {pnl === null ? (
                <span className="muted">—</span>
              ) : (
                <>
                  <div className={`mono ${pnl >= 0 ? "green" : "red"}`}>{pnl >= 0 ? "+" : ""}{inr(pnl)}</div>
                  <div className={`sub ${pct! >= 0 ? "green" : "red"}`}>{pct! >= 0 ? "+" : ""}{pct!.toFixed(2)}%</div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Trades({ s }: { s: Status }) {
  return (
    <div className="card">
      {s.trades.length === 0 && <p className="center muted" style={{ padding: 14 }}>No trades yet</p>}
      {s.trades.map((t, i) => (
        <div className="row" key={i}>
          <div>
            <div>
              <span className={t.side === "buy" ? "green" : "red"}>{t.side.toUpperCase()}</span>{" "}
              {mkt(t.market)}
              {t.dry_run ? <span className="sub"> (dry)</span> : null}
            </div>
            <div className="sub">{ts(t.ts)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono">{t.qty} @ {inr(t.price)}</div>
            {t.realized_pnl !== 0 && (
              <div className={`sub ${t.realized_pnl >= 0 ? "green" : "red"}`}>
                {t.realized_pnl >= 0 ? "+" : ""}{inr(t.realized_pnl)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const PAGE = 10;
type SignalFilter = "all" | "buy" | "sell";

// Action strings from the bot are uppercase ("BUY"/"SELL"/"HOLD" — see
// bot/strategies/base.py's decide() contract), so normalize case before comparing.
const cls = (a: string) => {
  const v = a.toLowerCase();
  return v === "buy" ? "green" : v === "sell" ? "red" : "yellow";
};
const rowCls = (a: string) => {
  const v = a.toLowerCase();
  return v === "buy" ? "sig-buy" : v === "sell" ? "sig-sell" : "sig-hold";
};

function Signals({ s }: { s: Status }) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [filtered, setFiltered] = useState<Signal[] | null>(null);

  // Most logged signals are HOLD (engine.py logs one every poll cycle regardless of
  // action), so the latest-30 status payload has too few BUY/SELL rows to filter
  // client-side. When a filter is active, fetch the fuller history from the bot
  // instead, self-polling like MarketChart does for its own data.
  useEffect(() => {
    if (filter === "all") {
      setFiltered(null);
      return;
    }
    let live = true;
    const load = () =>
      fetch(`/api/signals?action=${filter}`)
        .then((r) => r.json())
        .then((d) => live && setFiltered(Array.isArray(d.signals) ? d.signals : []))
        .catch(() => {});
    load();
    const id = setInterval(load, 10000);
    return () => { live = false; clearInterval(id); };
  }, [filter]);

  useEffect(() => setPage(0), [filter]);

  const rows = filter === "all" ? (s.signals ?? []) : (filtered ?? []);

  return (
    <div className="card">
      <div className="tabs">
        {(["all", "buy", "sell"] as SignalFilter[]).map((f) => (
          <button key={f} className={`tab ${f === filter ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="center muted" style={{ padding: 14 }}>No signals yet</p>
      ) : (
        <SignalsTable rows={rows} page={page} setPage={setPage} />
      )}
    </div>
  );
}

function SignalsTable({ rows, page, setPage }: { rows: Signal[]; page: number; setPage: (p: number) => void }) {
  const pages = Math.ceil(rows.length / PAGE);
  const p = Math.min(page, pages - 1); // clamp if list shrank since last render
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE);

  return (
    <>
      <table className="tbl">
        <thead>
          <tr><th>Date / Time</th><th>Coin</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>Decision</th></tr>
        </thead>
        <tbody>
          {slice.map((g, i) => (
            <tr key={i} className={rowCls(g.action)}>
              <td className={cls(g.action)}>{ts(g.ts)}<div className="sub">{g.strategy}</div></td>
              <td className={cls(g.action)}>{mkt(g.market)}</td>
              <td className={`mono ${cls(g.action)}`} style={{ textAlign: "right" }}>{inr(g.price)}</td>
              <td className={cls(g.action)} style={{ textAlign: "right", fontWeight: 600 }}>{g.action.toUpperCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager">
          <button onClick={() => setPage(p - 1)} disabled={p === 0}>‹ Prev</button>
          <span className="sub">Page {p + 1} / {pages}</span>
          <button onClick={() => setPage(p + 1)} disabled={p >= pages - 1}>Next ›</button>
        </div>
      )}
    </>
  );
}

function Stat({ l, v, cls }: { l: string; v: string; cls?: string }) {
  return (
    <div className="kv">
      <span className="l">{l}</span>
      <span className={`v ${cls ?? ""}`}>{v}</span>
    </div>
  );
}
