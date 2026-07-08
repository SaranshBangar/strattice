// Cloudflare D1 over the REST API (no Workers binding on Vercel). Same DB the Python
// supervisor reads/writes. Use `?` positional params (SQLite style).
//
// Local development: D1 IS SQLite and strattice/db/schema.sql is plain SQLite DDL, so
// when the CF_* vars are absent (and we're not in production) queries run against a
// local file instead - the whole app works without a Cloudflare account. Deployments
// with CF_* set never touch this path.
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const DB = process.env.CF_D1_DATABASE_ID;
const TOKEN = process.env.CF_API_TOKEN;

const useLocal =
  (!ACCOUNT || !DB || !TOKEN) && process.env.NODE_ENV !== "production";

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
};

let localDb: SqliteDb | null = null;

function getLocalDb(): SqliteDb {
  if (localDb) return localDb;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  const path = require("node:path");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const file =
    process.env.D1_LOCAL_PATH ?? path.join(process.cwd(), ".data", "dev.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file) as SqliteDb;
  db.exec("pragma journal_mode = wal");
  // schema.sql is `create table if not exists` throughout, so re-applying is a no-op.
  const schema = path.join(process.cwd(), "..", "db", "schema.sql");
  if (fs.existsSync(schema)) db.exec(fs.readFileSync(schema, "utf8"));
  localDb = db;
  return db;
}

// D1's REST API accepts booleans/undefined in params; node:sqlite does not.
function bindable(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function endpoint(): string {
  if (!ACCOUNT || !DB || !TOKEN)
    throw new Error("set CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN");
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;
}

export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (useLocal) {
    const db = getLocalDb();
    return db.prepare(sql).all(...params.map(bindable)) as T[];
  }
  const r = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  });
  const body = await r.json();
  if (!body.success)
    throw new Error("D1 error: " + JSON.stringify(body.errors));
  return body.result[0].results as T[];
}

export async function d1First<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await d1Query<T>(sql, params);
  return rows[0] ?? null;
}
