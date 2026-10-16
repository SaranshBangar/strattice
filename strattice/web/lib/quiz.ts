// Beginner strategy quiz: five plain-English questions, each answer nudging
// the score of the live strategy templates (lib/strategies.ts). Pure data +
// scoring - the UI lives in components/StrategyQuiz.tsx.

export type QuizKey =
  | "bb_breakout"
  | "donchian_trend"
  | "tsmom"
  | "momentum"
  | "vol_expansion"
  | "supertrend"
  | "macd_trend"
  | "trend_regime";

export type QuizOption = {
  label: string;
  /** Short "why this fits you" phrase echoed in the result panel. */
  trait: string;
  weights: Partial<Record<QuizKey, number>>;
};

export type QuizQuestion = {
  q: string;
  options: QuizOption[];
};

export const QUIZ: QuizQuestion[] = [
  {
    q: "How often would you like the bot to trade?",
    options: [
      {
        label: "Rarely — a few careful trades a year is fine",
        trait: "you prefer patience over constant action",
        weights: { trend_regime: 3, tsmom: 3, donchian_trend: 2, supertrend: 1 },
      },
      {
        label: "Now and then — when something genuinely breaks out",
        trait: "you want the bot acting only on decisive moves",
        weights: { momentum: 3, bb_breakout: 2, macd_trend: 2, vol_expansion: 1 },
      },
      {
        label: "No preference — whatever historically works",
        trait: "you care about results, not activity",
        weights: { bb_breakout: 2, donchian_trend: 2, vol_expansion: 1, tsmom: 1 },
      },
    ],
  },
  {
    q: "A trade is up 8%, then slips back to +3%. What should the bot do?",
    options: [
      {
        label: "Hold on — the occasional big win pays for everything",
        trait: "you can sit through swings to catch the big moves",
        weights: { tsmom: 3, trend_regime: 2, donchian_trend: 2, momentum: 1 },
      },
      {
        label: "Tighten the exit and protect what's left of the gain",
        trait: "you'd trade some upside for steadier exits",
        weights: { supertrend: 3, bb_breakout: 2, macd_trend: 1 },
      },
      {
        label: "Take the profit and look for the next trade",
        trait: "you like wins banked quickly",
        weights: { vol_expansion: 2, bb_breakout: 2 },
      },
    ],
  },
  {
    q: "How far below its best level could your balance dip before you'd lose sleep?",
    options: [
      {
        label: "A few percent — I'd rather exit early and often",
        trait: "you want drawdowns kept shallow",
        weights: { bb_breakout: 3, supertrend: 2, donchian_trend: 1 },
      },
      {
        label: "10–15%, if the system usually recovers",
        trait: "you accept normal trend-following swings",
        weights: { tsmom: 2, momentum: 2, macd_trend: 2, vol_expansion: 2 },
      },
      {
        label: "I judge results over a year, not a week",
        trait: "you think in long horizons",
        weights: { trend_regime: 3, tsmom: 3, donchian_trend: 1 },
      },
    ],
  },
  {
    q: "Which sentence sounds most like you?",
    options: [
      {
        label: "I want the simplest rule I can fully understand",
        trait: "you value rules you can explain in one sentence",
        weights: { donchian_trend: 3, trend_regime: 2, supertrend: 1 },
      },
      {
        label: "I want to catch big moves early, when a quiet market wakes up",
        trait: "you're drawn to explosive breakouts",
        weights: { vol_expansion: 3, bb_breakout: 2 },
      },
      {
        label: "I want to ride trends that are already proving themselves",
        trait: "you'd rather join strength than predict it",
        weights: { tsmom: 3, momentum: 2, macd_trend: 1 },
      },
    ],
  },
  {
    q: "How hands-on do you plan to be?",
    options: [
      {
        label: "Set it up once, glance at it weekly",
        trait: "you want a set-and-forget system",
        weights: { trend_regime: 3, tsmom: 2, donchian_trend: 2, supertrend: 1 },
      },
      {
        label: "Check in most days",
        trait: "you'll keep an active eye on it",
        weights: { momentum: 2, vol_expansion: 2, macd_trend: 2 },
      },
      {
        label: "Watching closely at first, then relaxing",
        trait: "you want to build trust before stepping back",
        weights: { bb_breakout: 2, supertrend: 2, macd_trend: 1 },
      },
    ],
  },
];

// Ties break toward the slower, more forgiving templates - the right default
// for someone who needed a quiz to choose.
const TIE_ORDER: QuizKey[] = [
  "trend_regime",
  "tsmom",
  "donchian_trend",
  "supertrend",
  "bb_breakout",
  "macd_trend",
  "momentum",
  "vol_expansion",
];

export function recommend(answers: number[]): {
  key: QuizKey;
  runnerUp: QuizKey;
  traits: string[];
} {
  const score = Object.fromEntries(TIE_ORDER.map((k) => [k, 0])) as Record<
    QuizKey,
    number
  >;
  const traits: string[] = [];
  answers.forEach((a, i) => {
    const opt = QUIZ[i]?.options[a];
    if (!opt) return;
    traits.push(opt.trait);
    for (const [k, w] of Object.entries(opt.weights))
      score[k as QuizKey] += w ?? 0;
  });
  const ranked = [...TIE_ORDER].sort(
    (a, b) => score[b] - score[a] || TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b),
  );
  return { key: ranked[0], runnerUp: ranked[1], traits };
}
