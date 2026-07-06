"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp, sendVerificationEmail } from "@/lib/auth-client";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/Spinner";

const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder-faint focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "block text-sm font-medium text-dim";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gbusy, setGbusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // Set once the account exists but the email still needs confirming - covers both a
  // fresh sign-up and a sign-in attempt on an unverified account.
  const [pendingVerify, setPendingVerify] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res =
      mode === "sign-up"
        ? await signUp.email({ email, password, name: name || email })
        : await signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      // Unverified sign-in: Better Auth has re-sent the link. Show the verify notice
      // rather than a raw error.
      if ((res.error as { code?: string }).code === "EMAIL_NOT_VERIFIED") {
        setPendingVerify(email);
        return;
      }
      const msg =
        res.error.message ?? "Something went wrong. Please try again.";
      setErr(msg);
      toast(msg, "error");
      return;
    }
    // Sign-up creates no session until the email is verified, so route to the notice
    // instead of a dashboard the user can't load yet.
    if (mode === "sign-up") {
      setPendingVerify(email);
      return;
    }
    toast("Signed in", "success");
    router.push("/dashboard");
    router.refresh();
  }

  async function resendVerification() {
    if (!pendingVerify) return;
    setResending(true);
    const res = await sendVerificationEmail({
      email: pendingVerify,
      callbackURL: "/dashboard",
    });
    setResending(false);
    toast(
      res.error ? "Couldn't resend right now." : "Verification email sent.",
      res.error ? "error" : "success",
    );
  }

  async function google() {
    setGbusy(true);
    try {
      await signIn.social({ provider: "google", callbackURL: "/dashboard" });
    } catch {
      setGbusy(false);
      toast("Couldn't start Google sign-in. Please try again.", "error");
    }
  }

  if (pendingVerify) {
    return (
      <div className="mx-auto w-full max-w-md card p-6">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
          Verify your email
        </h1>
        <p className="mt-2 text-sm text-muted">
          We&apos;ve sent a verification link to{" "}
          <span className="text-fg">{pendingVerify}</span>. Click it to activate
          your account, then sign in.
        </p>
        <button
          type="button"
          onClick={resendVerification}
          disabled={resending}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {resending && <Spinner className="h-4 w-4" />}
          {resending ? "Sending…" : "Resend link"}
        </button>
        <p className="mt-4 text-center text-sm text-muted">
          <Link
            href="/sign-in"
            className="text-accent underline-offset-2 hover:underline"
            onClick={() => setPendingVerify(null)}
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md card p-6">
      <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
        {mode === "sign-up" ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "sign-up"
          ? "Start running strategies on your own CoinDCX account."
          : "Welcome back to Strattice."}
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "sign-up" && (
          <div className="space-y-1.5">
            <label htmlFor="af-name" className={labelClass}>
              Name
            </label>
            <input
              id="af-name"
              className={inputClass}
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="af-email" className={labelClass}>
            Email
          </label>
          <input
            id="af-email"
            className={inputClass}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="af-password" className={labelClass}>
              Password
            </label>
            {mode === "sign-in" && (
              <Link
                href="/forgot-password"
                className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <input
              id="af-password"
              className={`${inputClass} pr-16`}
              type={showPw ? "text" : "password"}
              placeholder="••••••••"
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-r-md"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          {mode === "sign-up" && (
            <p className="text-xs text-faint">At least 8 characters.</p>
          )}
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
          {busy ? "Signing in…" : mode === "sign-up" ? "Sign up" : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        type="button"
        onClick={google}
        disabled={gbusy || busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2.5 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {gbusy ? <Spinner className="h-4 w-4" /> : <GoogleIcon />}
        {gbusy ? "Connecting…" : "Continue with Google"}
      </button>

      <p className="mt-4 text-center text-sm text-muted">
        {mode === "sign-up" ? (
          <>
            Have an account?{" "}
            <Link
              href="/sign-in"
              className="text-accent underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href="/sign-up"
              className="text-accent underline-offset-2 hover:underline"
            >
              Create one
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

// Official Google "G" mark (4-colour). Keep the viewBox/paths intact for brand compliance.
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.582c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.168 6.656 3.582 9 3.582Z"
      />
    </svg>
  );
}
