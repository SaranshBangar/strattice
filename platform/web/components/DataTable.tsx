export type DataTableProps = {
  title?: string;
  head: string[];
  rows: (string | number)[][];
  empty?: string;
};

export function DataTable({ title, head, rows, empty }: DataTableProps) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      {title && (
        <div className="border-b border-line px-4 py-3">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">{title}</h3>
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
              <tr className="border-b border-line text-left">
                {head.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-line/60 last:border-0 hover:bg-inset/60"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={[
                        "whitespace-nowrap px-4 py-2.5 font-mono tnum",
                        j === 0 ? "font-medium text-fg" : "text-dim",
                      ].join(" ")}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
