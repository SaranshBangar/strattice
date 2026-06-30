// Cloudflare D1 over the REST API (no Workers binding on Vercel). Same DB the Python
// supervisor reads/writes. Use `?` positional params (SQLite style).
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const DB = process.env.CF_D1_DATABASE_ID;
const TOKEN = process.env.CF_API_TOKEN;

function endpoint(): string {
  if (!ACCOUNT || !DB || !TOKEN) throw new Error("set CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN");
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;
}

export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await fetch(endpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  });
  const body = await r.json();
  if (!body.success) throw new Error("D1 error: " + JSON.stringify(body.errors));
  return body.result[0].results as T[];
}

export async function d1First<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await d1Query<T>(sql, params);
  return rows[0] ?? null;
}
