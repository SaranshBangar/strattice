"use client";
import { useEffect, useState } from "react";
import MarketChart from "../components/MarketChart";
import { biometricAvailable, enrollFingerprint } from "@/lib/webauthn-client";

type Pos = { strategy: string; market: string; qty: number; avg_price: number };
type Trade = { ts: string; market: string; side: string; qty: number; price: number; status: string; dry_run: number; realized_pnl: number };
type Signal = { ts: string; strategy: string; market: string; action: string; price: number; meta: string };
type Status = {
  mode: string; quote: string; inr_per_usdt: number | null; equity_basis: string; kill_switch: boolean;
  equity: number; free: number; trades_today: number; max_trades_per_day: number;
  realized_today: number; loss_limit: number; tds_today: number;
  capital_at_risk: number; cap_ceiling: number; total_realized: number;
  positions: Pos[]; trades: Trade[]; signals: Signal[];
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
  const [bio, setBio] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBio);
  }, []);

  async function enroll() {
    try {
      await enrollFingerprint();
      setEnrolled(true);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function load() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const data: Status = await r.json();
      setS(data);
      setErr("");
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

      {bio && (
        <button className="ghost" onClick={enroll}>
          {enrolled ? "✓ fingerprint enabled" : "enable fingerprint unlock"}
        </button>
      )}

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

function Signals({ s }: { s: Status }) {
  const [page, setPage] = useState(0);
  const rows = s.signals ?? [];
  if (rows.length === 0)
    return <div className="card"><p className="center muted" style={{ padding: 14 }}>No signals yet</p></div>;

  const pages = Math.ceil(rows.length / PAGE);
  const p = Math.min(page, pages - 1); // clamp if list shrank since last render
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE);
  const cls = (a: string) => (a === "buy" ? "green" : a === "sell" ? "red" : "muted");

  return (
    <div className="card">
      <table className="tbl">
        <thead>
          <tr><th>Date / Time</th><th>Coin</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>Decision</th></tr>
        </thead>
        <tbody>
          {slice.map((g, i) => (
            <tr key={i}>
              <td>{ts(g.ts)}<div className="sub">{g.strategy}</div></td>
              <td>{mkt(g.market)}</td>
              <td className="mono" style={{ textAlign: "right" }}>{inr(g.price)}</td>
              <td style={{ textAlign: "right" }}><span className={cls(g.action)}>{g.action.toUpperCase()}</span></td>
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
    </div>
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
