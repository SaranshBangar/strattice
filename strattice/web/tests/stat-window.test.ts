// The dashboard stat-card timeline preference resolves untrusted stored/user values to a
// known window and turns the chosen window into a UTC cutoff matching equity_snapshots.ts.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAT_WINDOW,
  STAT_WINDOWS,
  isStatWindow,
  statWindow,
  windowSinceISO,
} from "@/lib/stat-window";

describe("isStatWindow", () => {
  it("accepts every defined key and rejects anything else", () => {
    for (const k of Object.keys(STAT_WINDOWS))
      expect(isStatWindow(k)).toBe(true);
    for (const bad of ["", "2d", "day", "1D", "__proto__", "toString"])
      expect(isStatWindow(bad)).toBe(false);
  });
});

describe("statWindow", () => {
  it("defaults to 1 day for missing/unknown values", () => {
    for (const v of [null, undefined, "", "nope"])
      expect(statWindow(v).key).toBe(DEFAULT_STAT_WINDOW);
    expect(DEFAULT_STAT_WINDOW).toBe("1d");
    expect(statWindow("1d").hours).toBe(24);
  });

  it("returns the matching window for a valid key", () => {
    expect(statWindow("1w").days).toBe(7);
    expect(statWindow("all").hours).toBeNull();
  });
});

describe("windowSinceISO", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0); // 2026-07-17 12:00:00 UTC

  it("formats a UTC cutoff matching the stored ts format (no T, no ms)", () => {
    expect(windowSinceISO(24, now)).toBe("2026-07-16 12:00:00");
    expect(windowSinceISO(6, now)).toBe("2026-07-17 06:00:00");
    expect(windowSinceISO(1, now)).toBe("2026-07-17 11:00:00");
  });

  it("returns null for the all-time window", () => {
    expect(windowSinceISO(null, now)).toBeNull();
    expect(windowSinceISO(statWindow("all").hours, now)).toBeNull();
  });
});
