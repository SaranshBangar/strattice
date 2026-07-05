"use client";
// Landing-page primary CTA. Signed-in visitors get a direct route into the app
// instead of a redundant "get started".
import Link from "next/link";
import { useSession } from "@/lib/auth-client";

export function HeroCta() {
  const { data } = useSession();
  const signedIn = !!data?.user;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Link
        href={signedIn ? "/dashboard" : "/sign-up"}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {signedIn ? "Go to dashboard" : "Get started free"}
      </Link>
      <Link
        href="#features"
        className="rounded-md bg-white/5 px-5 py-2.5 text-sm font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        What&rsquo;s included
      </Link>
    </div>
  );
}
