# D1 migrations

Ordered, forward-only schema changes for the platform database, applied with `wrangler`.

## How it fits together

- **`../schema.sql`** is the full baseline snapshot — everything a *fresh* database needs.
  Apply it once when standing up a new D1 instance.
- **`migrations/NNNN_name.sql`** are the incremental changes applied to an *existing*
  database, in filename order. Each new schema change gets a new numbered file here **and**
  is folded into `schema.sql` so a fresh DB still gets it in one shot.

Before this directory existed, schema changes were made by editing `schema.sql` in place and
relying on runtime self-healing in `lib/queries.ts` (it catches `no such table/column` and
issues the DDL on the fly). That self-heal stays as a safety net, but new changes should be
tracked here so schema drift is visible and reviewable.

## Conventions

- **Idempotent**: use `create table if not exists` / guarded changes so re-running is safe.
  SQLite has no `add column if not exists`; for a new column, keep the runtime self-heal in
  `lib/queries.ts` as the compatibility path, or gate the migration behind a one-time check.
- **Forward-only**: never edit a migration after it has been applied anywhere — add a new one.
- **Numbered**: zero-padded, incrementing (`0001_`, `0002_`, …).

## Applying

```bash
# a single migration (from repo root)
wrangler d1 execute coindcx --file strattice/db/migrations/0001_rate_limit.sql --remote
```

| File                   | What                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `0001_rate_limit.sql`  | `rateLimit` table for Better Auth's DB-backed limiter (see lib/auth.ts) |
| `0002_perf_indexes.sql` | Indexes on `subscriptions.cashfree_sub_id`, `account.userId`, `session.userId`, `user_strategies(user_id, position)` |
