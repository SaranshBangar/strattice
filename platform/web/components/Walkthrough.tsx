"use client";
// First-run product tour. Auto-opens once for a signed-in user (tracked in localStorage),
// and can be reopened on demand from anywhere by dispatching `window` event "strattice:tour"
// (see <TourButton/>). Fully skippable; keyboard: ←/→ to move, Esc to close.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";

const SEEN_KEY = "strattice.tour.v1";
export const TOUR_EVENT = "strattice:tour";

type Step = { icon: React.ReactNode; title: string; body: string; href?: string; cta?: string };

const STEPS: Step[] = [
  {
    icon: <IconSpark />,
    title: "Welcome to Strattice",
    body: "Automated trading strategies that run on your own CoinDCX account. It's non-custodial - we never hold your funds, and you keep control of the keys.",
  },
  {
    icon: <IconKey />,
    title: "Link your CoinDCX keys",
    body: "On the Account page, paste an API key with trading enabled and withdrawals disabled. It's encrypted at rest and never shown back to you.",
    href: "/account",
    cta: "Go to Account",
  },
  {
    icon: <IconLayers />,
    title: "Choose your strategies",
    body: "Browse the Strategies page, preview each one's entries and exits on live market data, then enable the ones you want the bot to run.",
    href: "/strategies",
    cta: "Browse strategies",
  },
  {
    icon: <IconPower />,
    title: "Flip the bot on",
    body: "Turn the bot on from Account. It starts in DRY_RUN - simulated orders only. Switch to LIVE when you've reviewed the trades and you're ready.",
    href: "/account",
    cta: "Bot controls",
  },
  {
    icon: <IconChart />,
    title: "Track everything",
    body: "The Dashboard shows your equity curve, daily P&L, win rate and every trade the bot makes, in real time.",
    href: "/dashboard",
    cta: "Open dashboard",
  },
  {
    icon: <IconBell />,
    title: "Stay in the loop",
    body: "Turn on email or Telegram alerts so you hear about every buy and sell the moment it happens. You can replay this tour anytime from the Account page.",
    href: "/account",
    cta: "Set up alerts",
  },
];

export function Walkthrough() {
  const { data } = useSession();
  const signedIn = !!data?.user;
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((markSeen: boolean) => {
    if (markSeen) {
      try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    }
    setOpen(false);
  }, []);

  const start = useCallback(() => {
    setI(0);
    setOpen(true);
  }, []);

  // Auto-open once per browser for a signed-in user.
  useEffect(() => {
    if (!signedIn) return;
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch {}
    if (!seen) {
      const t = setTimeout(start, 500);
      return () => clearTimeout(t);
    }
  }, [signedIn, start]);

  // Reopen on demand (replay button, anywhere in the app).
  useEffect(() => {
    const onTour = () => start();
    window.addEventListener(TOUR_EVENT, onTour);
    return () => window.removeEventListener(TOUR_EVENT, onTour);
  }, [start]);

  // Keyboard nav while open.
  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
      else if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const first = i === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      className="fixed inset-0 z-[70] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close tour"
        onClick={() => close(true)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm [animation:toastIn_.2s_ease-out]"
      />
      <div className="relative w-full max-w-md overflow-hidden card shadow-2xl shadow-black/60 [animation:rise_.35s_ease-out_both]">
        <div className="flex items-start justify-between px-6 pt-6">
          <span className="grid h-11 w-11 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            {step.icon}
          </span>
          <button
            type="button"
            onClick={() => close(true)}
            className="rounded-md p-1 text-faint transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Skip tour"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-2 pt-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Step {i + 1} of {STEPS.length}
          </div>
          <h2 id="tour-title" className="mt-1.5 font-display text-lg font-semibold tracking-tight text-fg">
            {step.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-dim">{step.body}</p>
          {step.href && step.cta && (
            <Link
              href={step.href}
              onClick={() => close(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-hi"
            >
              {step.cta}
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>

        {/* progress dots */}
        <div className="flex items-center gap-1.5 px-6 py-4">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Go to step ${idx + 1}`}
              onClick={() => setI(idx)}
              className={[
                "h-1.5 rounded-full transition-all",
                idx === i ? "w-5 bg-accent" : "w-1.5 bg-line hover:bg-muted",
              ].join(" ")}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            onClick={() => close(true)}
            className="text-sm text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {!first && (
              <button
                type="button"
                onClick={() => setI((v) => Math.max(v - 1, 0))}
                className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              onClick={() => (last ? close(true) : setI((v) => v + 1))}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- icons (inline, 20px stroke) ----------
function svg(children: React.ReactNode) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function IconSpark() { return svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></>); }
function IconKey() { return svg(<><circle cx="8" cy="8" r="4" /><path d="m11 11 8 8M16 16l2-2M19 19l2-2" /></>); }
function IconLayers() { return svg(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>); }
function IconPower() { return svg(<><path d="M12 4v8M7.5 7a7 7 0 1 0 9 0" /></>); }
function IconChart() { return svg(<><path d="M4 20V4M4 20h16M8 16l3-4 3 2 4-6" /></>); }
function IconBell() { return svg(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.5 20a2 2 0 0 0 3 0" /></>); }
