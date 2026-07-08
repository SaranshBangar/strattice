"use client";
// Beginner strategy quiz: one question per step, progress dots, and a result
// panel that recommends one of the live templates with "why this fits you"
// bullets. Local state only - nothing is stored. Questions and scoring live
// in lib/quiz.ts.
import { useState } from "react";
import Link from "next/link";
import { QUIZ, recommend } from "@/lib/quiz";
import { STRATEGY_META } from "@/lib/strategies";
import { useSession } from "@/lib/auth-client";

export function StrategyQuiz() {
  const { data } = useSession();
  const signedIn = !!data?.user;
  const [answers, setAnswers] = useState<number[]>([]);
  const step = answers.length;
  const done = step >= QUIZ.length;

  function pick(i: number) {
    if (!done) setAnswers((a) => [...a, i]);
  }
  function back() {
    setAnswers((a) => a.slice(0, -1));
  }
  function reset() {
    setAnswers([]);
  }

  const result = done ? recommend(answers) : null;
  const meta = result ? STRATEGY_META[result.key] : null;
  const runnerMeta = result ? STRATEGY_META[result.runnerUp] : null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
          strategy_match
        </span>
        <span
          className="flex items-center gap-1.5"
          aria-label={`Question ${Math.min(step + 1, QUIZ.length)} of ${QUIZ.length}`}
        >
          {QUIZ.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-[1px] transition-colors ${
                i < step ? "bg-accent" : i === step && !done ? "bg-dim" : "bg-line"
              }`}
            />
          ))}
        </span>
      </div>

      {!done ? (
        <div className="p-5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
            question {step + 1} / {QUIZ.length}
          </p>
          <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-fg">
            {QUIZ[step].q}
          </h3>
          <div className="mt-4 space-y-2">
            {QUIZ[step].options.map((o, i) => (
              <button
                key={o.label}
                onClick={() => pick(i)}
                className="flex w-full items-center gap-3 rounded-lg bg-inset/70 px-4 py-3 text-left text-sm text-dim transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-mono text-[11px] text-faint">
                  {String.fromCharCode(97 + i)}
                </span>
                {o.label}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button
              onClick={back}
              className="mt-4 font-mono text-[11px] text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ← back
            </button>
          )}
        </div>
      ) : (
        <div className="p-5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-gain">
            your match
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h3 className="font-display text-xl font-bold tracking-tight text-fg">
              {meta!.label}
            </h3>
            <span className="rounded-sm bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              {meta!.kind}
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {meta!.blurb} {meta!.style}
          </p>
          <ul className="mt-4 space-y-1.5">
            {result!.traits.slice(0, 3).map((t) => (
              <li
                key={t}
                className="flex items-start gap-2 text-sm text-dim"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[1px] bg-accent"
                />
                Because {t}.
              </li>
            ))}
          </ul>
          {runnerMeta && (
            <p className="mt-3 text-xs text-faint">
              Close second: {runnerMeta.label} — worth previewing too.
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/strategies" : "/sign-up"}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {signedIn
                ? "Preview it on live data"
                : "Try it free in paper mode"}
            </Link>
            <button
              onClick={reset}
              className="rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Retake quiz
            </button>
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-faint">
            a starting point, not advice — every template previews on real data
            before you commit
          </p>
        </div>
      )}
    </div>
  );
}
