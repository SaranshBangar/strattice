import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { financialYear, taxReportRows } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Downloadable CSV of every LIVE sell leg in an Indian financial year — the raw
// material for Schedule VDA. One row per taxable disposal; DRY_RUN never appears.
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?fy=2026 selects FY 2026-27; default is the current FY.
  const url = new URL(req.url);
  const fyParam = url.searchParams.get("fy");
  const now = new Date();
  let fy = financialYear(now);
  if (fyParam) {
    const y = Number(fyParam);
    if (!Number.isInteger(y) || y < 2020 || y > now.getUTCFullYear() + 1) {
      return NextResponse.json({ error: "invalid fy" }, { status: 400 });
    }
    fy = { startISO: `${y}-04-01`, endISO: `${y + 1}-04-01`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}` };
  }

  const rows = await taxReportRows(user.id, fy.startISO, fy.endISO);
  const head = ["time_utc", "market", "strategy", "qty", "sale_price", "sale_consideration", "realized_pnl", "tds_withheld"];
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    // Neutralize spreadsheet formula injection (=, +, -, @ starters) — strategy
    // names are user-controlled and this file is destined for Excel. Plain
    // numbers (e.g. negative P&L) are left untouched.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.ts, r.market, r.strategy, r.qty, r.price, r.notional, r.realized_pnl, r.tds].map(esc).join(","),
  );
  const csv = [head.join(","), ...lines].join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vda-sells-${fy.startISO.slice(0, 4)}-${fy.endISO.slice(0, 4)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
