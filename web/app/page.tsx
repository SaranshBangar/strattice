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

type Tab = "Overview" | "Positions" | "Trades" | "Signals" | "Chart";
const TABS: Tab[] = ["Overview", "Positions", "Trades", "Signals", "Chart"];

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const mkt = (m: string) => m.replace("I-", "").replace("_INR", "");
const ts = (t: string) => t.replace("T", " ").slice(0, 16);

export default function Dashboard() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>("Overview");
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
      <h1>
        Bot Dashboard
        {s && <span className={`pill ${s.mode.toLowerCase().includes("live") ? "live" : "off"}`}>{s.mode}</span>}
        <button className="refresh" onClick={load}>refresh</button>
      </h1>

      {bio && (
        <button
          className="refresh"
          style={{ marginLeft: 0, marginBottom: 10 }}
          onClick={enroll}
        >
          {enrolled ? "fingerprint enabled" : "enable fingerprint unlock"}
        </button>
      )}

      {err && <div className="card red">{err}</div>}
      {!s && !err && <p className="center muted">loading…</p>}

      {s && (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" && (
            <>
              <div className="card">
                <div className="grid">
                  <KV l="Equity (book)" v={inr(s.equity)} />
                  <KV l="Free" v={inr(s.free)} />
                  <KV l="Realized today" v={inr(s.realized_today)} cls={s.realized_today >= 0 ? "green" : "red"} />
                  <KV l="Total realized" v={inr(s.total_realized)} cls={s.total_realized >= 0 ? "green" : "red"} />
                  <KV l="Loss limit" v={inr(s.loss_limit)} cls="red" />
                  <KV l="TDS today" v={inr(s.tds_today)} />
                  <KV l="Capital at risk" v={`${inr(s.capital_at_risk)} / ${inr(s.cap_ceiling)}`} />
                  <KV l="Trades today" v={`${s.trades_today} / ${s.max_trades_per_day}`} />
                  <KV l="Quote currency" v={s.quote} />
                  {s.inr_per_usdt != null && <KV l="INR / USDT" v={inr(s.inr_per_usdt)} />}
                </div>
                <div className="row" style={{ marginTop: 10, borderTop: "1px solid var(--line)", borderBottom: 0 }}>
                  <span className="sub">Kill switch</span>
                  <span className={`pill ${s.kill_switch ? "off" : "on"}`}>{s.kill_switch ? "ACTIVE" : "off"}</span>
                </div>
                <div className="row" style={{ borderBottom: 0 }}>
                  <span className="sub">Equity basis</span>
                  <span className="sub">{s.equity_basis}</span>
                </div>
              </div>

              <h2>Open positions ({s.positions.length})</h2>
              <Positions s={s} prices={prices} />
              <h2>Recent trades ({s.trades.length})</h2>
              <Trades s={s} />
            </>
          )}

          {tab === "Positions" && (
            <>
              <h2>Open positions ({s.positions.length})</h2>
              <Positions s={s} prices={prices} />
            </>
          )}

          {tab === "Trades" && (
            <>
              <h2>Recent trades ({s.trades.length})</h2>
              <Trades s={s} />
            </>
          )}

          {tab === "Signals" && (
            <>
              <h2>Recent signals ({s.signals?.length ?? 0})</h2>
              <div className="card">
                {(!s.signals || s.signals.length === 0) && (
                  <p className="center muted" style={{ padding: 14 }}>No signals yet</p>
                )}
                {s.signals?.map((g, i) => (
                  <div className="row" key={i}>
                    <div>
                      <div>
                        <span className={g.action === "buy" ? "green" : g.action === "sell" ? "red" : "muted"}>
                          {g.action.toUpperCase()}
                        </span>{" "}
                        {mkt(g.market)}
                      </div>
                      <div className="sub">{g.strategy} · {ts(g.ts)}</div>
                    </div>
                    <div className="mono" style={{ textAlign: "right" }}>{inr(g.price)}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "Chart" && (
            <>
              <h2>Market</h2>
              <MarketChart />
            </>
          )}
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

function KV({ l, v, cls }: { l: string; v: string; cls?: string }) {
  return (
    <div className="kv">
      <span className="l">{l}</span>
      <span className={`v ${cls ?? ""}`}>{v}</span>
    </div>
  );
}
