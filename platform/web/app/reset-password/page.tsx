"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "@/lib/auth-client";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

function ResetPasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  // Better Auth redirects here with ?token=… on a valid link, or ?error=… if the
  // token was already invalid/expired at the redirect step.
  const token = params.get("token");
  const linkError = params.get("error");

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const invalidLink = !token || !!linkError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(null);
    setBusy(true);
    const res = await resetPassword({ newPassword: password, token });
    setBusy(false);
    if (res.error) {
      const msg =
        res.error.message ?? "That reset link is invalid or has expired.";
      setErr(msg);
      toast(msg, "error");
      return;
    }
    toast("Password updated. Please sign in.", "success");
    router.push("/sign-in");
  }

  return (
    <div className="mx-auto w-full max-w-md py-6">
      <div className="card p-6">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
          Choose a new password
        </h1>
        {invalidLink ? (
          <>
            <p className="mt-2 text-sm text-muted">
              This reset link is invalid or has expired. Request a new one to
              try again.
            </p>
            <p className="mt-4 text-sm text-muted">
              <Link
                href="/forgot-password"
                className="text-accent underline-offset-2 hover:underline"
              >
                Send a new reset link
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              Enter a new password for your account.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="rp-password" className={labelClass}>
                  New password
                </label>
                <div className="relative">
                  <input
                    id="rp-password"
                    className={`${inputClass} pr-16`}
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-xs text-faint">At least 8 characters.</p>
              </div>
              {err && (
                <p role="alert" className="text-sm text-loss">
                  {err}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {busy && <Spinner className="h-4 w-4" />}
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
