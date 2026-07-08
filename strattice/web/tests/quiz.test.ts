import { describe, expect, it } from "vitest";
import { QUIZ, recommend, type QuizKey } from "@/lib/quiz";

const VALID_KEYS: QuizKey[] = [
  "tsmom",
  "momentum",
  "squeeze_breakout",
  "ma_crossover",
  "vol_expansion",
  "supertrend",
];

describe("quiz data", () => {
  it("has five questions of three options each", () => {
    expect(QUIZ).toHaveLength(5);
    for (const q of QUIZ) expect(q.options).toHaveLength(3);
  });
  it("every weight targets a real template key", () => {
    for (const q of QUIZ)
      for (const o of q.options)
        for (const k of Object.keys(o.weights))
          expect(VALID_KEYS).toContain(k);
  });
});

describe("recommend", () => {
  it("no answers falls back to the patient default (tsmom)", () => {
    const r = recommend([]);
    expect(r.key).toBe("tsmom");
    expect(r.runnerUp).toBe("ma_crossover");
    expect(r.traits).toEqual([]);
  });

  it("out-of-range answer indices are ignored, not crashed on", () => {
    const r = recommend([9, 9, 9, 9, 9]);
    expect(r.key).toBe("tsmom"); // all scores zero -> tie order
    expect(r.traits).toEqual([]);
  });

  it("extra answers beyond the question count are ignored", () => {
    const r = recommend([0, 0, 0, 0, 0, 2, 1]);
    expect(VALID_KEYS).toContain(r.key);
    expect(r.traits).toHaveLength(5);
  });

  it("all-first answers land on a slow trend template", () => {
    // Hand-scored: ma_crossover 9, tsmom 8, supertrend 6.
    const r = recommend([0, 0, 0, 0, 0]);
    expect(r.key).toBe("ma_crossover");
    expect(r.runnerUp).toBe("tsmom");
  });

  it("breakout-leaning answers land on a breakout template", () => {
    // Trade on decisive moves, bank quickly, explosive breakouts.
    const r = recommend([1, 2, 2, 1, 2]);
    expect(["squeeze_breakout", "vol_expansion", "momentum"]).toContain(r.key);
  });

  it("patience + big-winner answers land on tsmom", () => {
    const r = recommend([0, 0, 2, 2, 0]);
    expect(r.key).toBe("tsmom");
  });

  it("every possible combination yields a valid, distinct top pair", () => {
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++)
          for (let d = 0; d < 3; d++)
            for (let e = 0; e < 3; e++) {
              const r = recommend([a, b, c, d, e]);
              expect(VALID_KEYS).toContain(r.key);
              expect(VALID_KEYS).toContain(r.runnerUp);
              expect(r.runnerUp).not.toBe(r.key);
              expect(r.traits).toHaveLength(5);
            }
  });

  it("the winner never has a lower score than the runner-up", () => {
    // Re-derive scores independently and check the ranking is honest.
    for (const answers of [
      [0, 1, 2, 0, 1],
      [2, 2, 2, 2, 2],
      [1, 0, 1, 0, 1],
    ]) {
      const score = Object.fromEntries(
        VALID_KEYS.map((k) => [k, 0]),
      ) as Record<QuizKey, number>;
      answers.forEach((a, i) => {
        for (const [k, w] of Object.entries(QUIZ[i].options[a].weights))
          score[k as QuizKey] += w ?? 0;
      });
      const r = recommend(answers);
      expect(score[r.key]).toBeGreaterThanOrEqual(score[r.runnerUp]);
      for (const k of VALID_KEYS)
        expect(score[r.key]).toBeGreaterThanOrEqual(score[k]);
    }
  });
});
