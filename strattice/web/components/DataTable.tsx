import type { ReactNode } from "react";

export type CellTone = "default" | "good" | "bad" | "warn" | "muted" | "fg";

export type Cell =
  | string
  | number
  | { v: ReactNode; tone?: CellTone; align?: "left" | "right" };

export type DataTableProps = {
  title?: string;
  head: string[];
  rows: Cell[][];
  empty?: string;
  /** Per-column default alignment, by header index. */
  align?: ("left" | "right")[];
};

const toneClass: Record<CellTone, string> = {
  default: "text-dim",
  good: "text-gain",
  bad: "text-loss",
  warn: "text-warn",
  muted: "text-muted",
  fg: "text-fg",
};

export function DataTable({ title, head, rows, empty, align }: DataTableProps) {
  return (
    <section className="card">
      {title && (
        <div className="px-4 py-3">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
            {title}
          </h3>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted">
          {empty ?? "Nothing to show yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th
                    key={h}
                    className={[
                      "whitespace-nowrap px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint",
                      align?.[j] === "right" ? "text-right" : "text-left",
                    ].join(" ")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="odd:bg-white/[0.015] hover:bg-inset/60">
                  {row.map((cell, j) => {
                    const obj =
                      typeof cell === "object" && cell !== null ? cell : null;
                    const value: ReactNode = obj ? obj.v : (cell as ReactNode);
                    const tone: CellTone =
                      obj?.tone ?? (j === 0 ? "fg" : "default");
                    const cellAlign = obj?.align ?? align?.[j] ?? "left";
                    return (
                      <td
                        key={j}
                        className={[
                          "whitespace-nowrap px-4 py-2.5 font-mono tnum",
                          j === 0 ? "font-medium" : "",
                          cellAlign === "right" ? "text-right" : "text-left",
                          toneClass[tone],
                        ].join(" ")}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
