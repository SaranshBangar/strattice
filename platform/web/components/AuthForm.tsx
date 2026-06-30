"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = mode === "sign-up"
      ? await signUp.email({ email, password, name: name || email })
      : await signIn.email({ email, password });
    setBusy(false);
    if (res.error) { setErr(res.error.message ?? "Failed"); return; }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm rounded-lg border border-line bg-panel p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
        {mode === "sign-up" ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "sign-up"
          ? "Start running strategies on your own CoinDCX account."
          : "Welcome back to CoinDCX Bots."}
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "sign-up" && (
          <div className="space-y-1.5">
            <label htmlFor="af-name" className={labelClass}>Name</label>
            <input id="af-name" className={inputClass} placeholder="Your name"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="af-email" className={labelClass}>Email</label>
          <input id="af-email" className={inputClass} type="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="af-password" className={labelClass}>Password</label>
          <input id="af-password" className={inputClass} type="password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {err && <p role="alert" className="text-sm text-loss">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? "..." : mode === "sign-up" ? "Sign up" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {mode === "sign-up" ? (
          <>Have an account? <Link href="/sign-in" className="text-accent underline-offset-2 hover:underline">Sign in</Link></>
        ) : (
          <>New here? <Link href="/sign-up" className="text-accent underline-offset-2 hover:underline">Create one</Link></>
        )}
      </p>
    </div>
  );
}
