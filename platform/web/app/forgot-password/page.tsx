"use client";
import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth-client";
import { Spinner } from "@/components/Spinner";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Ignore the result on purpose: showing the same confirmation whether or not the
    // address has an account avoids leaking which emails are registered.
    await requestPasswordReset({ email, redirectTo: "/reset-password" }).catch(
      () => {},
    );
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="mx-auto w-full max-w-md py-6">
      <div className="card p-6">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
          Reset your password
        </h1>
        {sent ? (
          <>
            <p className="mt-2 text-sm text-muted">
              If an account exists for{" "}
              <span className="text-fg">{email}</span>, we&apos;ve sent a link
              to reset your password. It expires in an hour.
            </p>
            <p className="mt-4 text-sm text-muted">
              <Link
                href="/sign-in"
                className="text-accent underline-offset-2 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              Enter your email and we&apos;ll send you a link to set a new
              password.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="fp-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="fp-email"
                  className={inputClass}
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {busy && <Spinner className="h-4 w-4" />}
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-muted">
              Remembered it?{" "}
              <Link
                href="/sign-in"
                className="text-accent underline-offset-2 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
