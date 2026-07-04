"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { isAdmin } from "@/lib/admin";
import { useToast } from "@/components/Toast";

const BASE_LINKS: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/strategies", "Strategies"],
  ["/account", "Account"],
];

export function Nav() {
  const { data } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const signedIn = !!data?.user;
  const LINKS: [string, string][] = isAdmin(data?.user?.email)
    ? [...BASE_LINKS, ["/admin", "Admin"]]
    : BASE_LINKS;

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    toast("Signed out", "success");
    router.push("/");
    router.refresh();
  }

  const linkClass = (href: string) =>
    [
      "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      pathname === href ? "bg-panel text-fg shadow-[inset_0_-2px_0_0_theme(colors.accent.DEFAULT)]" : "text-muted hover:bg-panel hover:text-fg",
    ].join(" ");

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimization needed */}
          <img src="/strattice-logo-transparent.svg" alt="Strattice" className="h-7 w-7" width={28} height={28} />
          <span className="font-display text-sm font-semibold tracking-tight text-fg">strattice</span>
        </Link>

        {signedIn ? (
          <>
            {/* Desktop links */}
            <div className="hidden items-center gap-1 sm:flex">
              {LINKS.map(([href, label]) => (
                <Link key={href} href={href} className={linkClass(href)}>
                  {label}
                </Link>
              ))}
              <button
                type="button"
                onClick={handleSignOut}
                className="ml-1 rounded-md border border-line px-3 py-1.5 text-sm text-dim transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign out
              </button>
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-md border border-line text-dim transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:hidden"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                {open ? (
                  <path strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
                ) : (
                  <path strokeLinecap="round" d="M3 6h14M3 10h14M3 14h14" />
                )}
              </svg>
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            {pathname === "/" && (
              <div className="mr-2 hidden items-center gap-1 md:flex">
                {([
                  ["#templates", "Templates"],
                  ["#costs", "Costs"],
                  ["#faq", "FAQ"],
                ] as const).map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    className="rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {label}
                  </a>
                ))}
              </div>
            )}
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

      {/* Mobile dropdown panel */}
      {signedIn && open && (
        <div className="border-t border-line bg-bg sm:hidden">
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3">
            {LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={[
                  "rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  pathname === href ? "bg-panel text-fg" : "text-muted hover:bg-panel hover:text-fg",
                ].join(" ")}
              >
                {label}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-1 rounded-md border border-line px-3 py-2.5 text-left text-sm text-dim transition-colors hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
