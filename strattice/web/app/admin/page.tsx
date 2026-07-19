import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import * as q from "@/lib/queries";
import { TIERS } from "@/lib/entitlements";
import { StatCard } from "@/components/StatCard";
import { AdminUserRow } from "@/components/AdminUserRow";
import { SupervisorControls } from "@/components/SupervisorControls";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  if (!isAdmin(user.email)) redirect("/dashboard");

  const { q: rawQ, page: rawPage } = await searchParams;
  const search = (rawQ ?? "").trim();
  const page = Math.max(1, Number(rawPage) || 1);

  const [stats, list, supervisor] = await Promise.all([
    q.adminStats(),
    q.listUsersAdmin(search, page, 20),
    q.getSupervisorStatus(),
  ]);

  const mrr = Object.entries(stats.byTier).reduce(
    (sum, [tier, n]) =>
      sum + (TIERS[tier as keyof typeof TIERS]?.priceInr ?? 0) * n,
    0,
  );
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const tierLine =
    Object.entries(stats.byTier)
      .sort(
        (a, b) =>
          (TIERS[b[0] as keyof typeof TIERS]?.priceInr ?? 0) -
          (TIERS[a[0] as keyof typeof TIERS]?.priceInr ?? 0),
      )
      .map(([t, n]) => `${t} ${n}`)
      .join(" · ") || "none";

  const pageHref = (p: number) =>
    `/admin?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Admin
          </h1>
          <p className="mt-1 font-mono text-xs text-faint">
            Owner console · {user.email}
          </p>
        </div>
        <span className="rounded-md bg-accent/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-accent">
          owner
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Users"
          value={String(stats.users)}
          sub={`${list.total} shown`}
        />
        <StatCard
          label="Paying"
          value={String(stats.paying)}
          sub={`${inr(mrr)} / mo est.`}
          tone="good"
        />
        <StatCard
          label="Active bots"
          value={String(stats.activeBots)}
          sub={`${stats.liveBots} live`}
          tone={stats.liveBots > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Trades"
          value={stats.trades.toLocaleString("en-IN")}
          sub={tierLine}
        />
      </div>

      <SupervisorControls status={supervisor} />

      <section className="card">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-display text-sm font-semibold tracking-tight text-dim">
            Users{" "}
            <span className="ml-1 font-mono text-xs font-normal text-faint">
              {list.total}
            </span>
          </h3>
          <form method="GET" className="flex items-center gap-2">
            <div className="relative">
              <svg
                viewBox="0 0 20 20"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="9" cy="9" r="6" />
                <path strokeLinecap="round" d="m17 17-3.5-3.5" />
              </svg>
              <input
                name="q"
                defaultValue={search}
                placeholder="Search by email…"
                aria-label="Search users by email"
                className="w-full rounded-md border border-line bg-inset py-1.5 pl-8 pr-3 text-xs text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-64"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Search
            </button>
            {search && (
              <Link
                href="/admin"
                className="rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-fg"
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        {list.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No users match “{search}”.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5">Joined</th>
                  <th className="px-4 py-2.5">Keys</th>
                  <th className="px-4 py-2.5">Bot</th>
                  <th className="px-4 py-2.5 text-right">Trades</th>
                  <th className="px-4 py-2.5">Plan</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((u) => (
                  <AdminUserRow key={u.id} u={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
            <span className="tabular-nums">
              Page {page} / {totalPages}
            </span>
            <div className="flex items-center gap-1">
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-md bg-white/5 px-2.5 py-1 font-mono transition-colors hover:bg-white/10 hover:text-fg"
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-md bg-white/5 px-2.5 py-1 font-mono transition-colors hover:bg-white/10 hover:text-fg"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      <p className="font-mono text-[11px] text-faint">
        Plan changes grant a 30-day comp window and take effect on the user's
        next dashboard load. Bot stops apply within one supervisor poll.
      </p>
    </div>
  );
}
