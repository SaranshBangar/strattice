// Drizzle over D1's REST API via the sqlite-proxy driver. Only Better Auth uses this ORM;
// app tables use the raw d1Query helper. sqlite-proxy wants rows as positional arrays, so we
// convert D1's object rows with Object.values (key order == selected-column order in SQLite).
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { d1Query } from "./d1";

export const db = drizzle(async (sql, params, method) => {
  const rows = await d1Query(sql, params as unknown[]);
  const arr = rows.map((r) => Object.values(r as Record<string, unknown>));
  return { rows: method === "get" ? (arr[0] ?? []) : arr };
});
