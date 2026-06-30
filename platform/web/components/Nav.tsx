"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";

const LINKS: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/strategies", "Strategies"],
  ["/billing", "Billing"],
  ["/account", "Account"],
];

export function Nav() {
  const { data } = useSession();
  const router = useRouter();
  const signedIn = !!data?.user;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-accent font-display text-sm font-bold text-accent-ink">
            C
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-fg">
            CoinDCX <span className="font-normal text-muted">Bots</span>
          </span>
        </Link>

        {signedIn ? (
          <div className="flex items-center gap-1">
            {LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {label}
              </Link>
            ))}
            <button
              type="button"
              onClick={async () => { await signOut(); router.push("/"); router.refresh(); }}
              className="ml-1 rounded-md border border-line px-3 py-1.5 text-sm text-dim transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-1.5 text-sm text-dim transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Get started
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
