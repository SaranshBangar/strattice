// User-built strategies: a small rule language composed of the same indicator blocks
// the stock templates use. The JSON definition is stored in user_strategies.params
// (template = "custom") and interpreted IDENTICALLY in two places:
//   - here, for the builder's live preview / historic analysis (runSim), and
//   - bot/strategies/custom.py, when the engine actually trades it.
// Keep the two evaluators in lockstep - the schema is versioned (v: 1) for evolution.
//
// Semantics: long-only entries. ALL rules must be true on the same bar to enter.
// Exits are the engine's shared protective layer configured per-strategy.

import {
  runSim,
  sma,
  stdev,
  atr,
  rsi,
  avgVolume,
  smaSeries,
  priorHighSeries,
  type Candle,
  type SimResult,
  type ExitConfig,
  type OverlaySeries,
} from "./strategy-sim";

export const CUSTOM_SCHEMA_VERSION = 1;

export type RuleValue = number | string;
export interface Rule {
  kind: string;
  [field: string]: RuleValue;
}

export interface CustomExits {
  stop_loss_pct: number; // REQUIRED hard stop, fraction (0.005 - 0.2)
  take_profit_pct: number; // 0 = none
  chandelier_k: number; // 0 = no trail
  atr_period: number;
  max_hold_bars: number; // 0 = no time-stop
}

export interface CustomDef {
  v: number;
  name: string;
  rules: Rule[];
  exits: CustomExits;
}

export const MAX_RULES = 8;

// ---------- rule catalog (drives the builder UI, the sanitizer, and eval) ----------

export interface NumField {
  t: "num";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  int?: boolean;
  unit?: string;
}
export interface EnumField {
  t: "enum";
  key: string;
  label: string;
  options: { value: string; label: string }[];
}
export type RuleField = NumField | EnumField;

export interface RuleKindSpec {
  kind: string;
  label: string;
  blurb: string; // what this block does, one line
  fields: RuleField[];
  defaults: Record<string, RuleValue>;
}

const OP_ABOVE_BELOW = [
  { value: "above", label: "above" },
  { value: "below", label: "below" },
];

export const RULE_CATALOG: RuleKindSpec[] = [
  {
    kind: "trend",
    label: "Trend filter (price vs SMA)",
    blurb:
      "Only trade when price is above (or below) its long moving average - the regime gate every stock template uses.",
    fields: [
      { t: "enum", key: "op", label: "Price is", options: OP_ABOVE_BELOW },
      {
        t: "num",
        key: "period",
        label: "SMA period",
        min: 5,
        max: 400,
        step: 1,
        int: true,
        unit: "bars",
      },
    ],
    defaults: { op: "above", period: 96 },
  },
  {
    kind: "sma_cross",
    label: "SMA cross (golden cross)",
    blurb:
      "A fast moving average crossed above a slow one within the last few bars - a fresh trend signal.",
    fields: [
      {
        t: "num",
        key: "fast",
        label: "Fast SMA",
        min: 2,
        max: 200,
        step: 1,
        int: true,
        unit: "bars",
      },
      {
        t: "num",
        key: "slow",
        label: "Slow SMA",
        min: 5,
        max: 400,
        step: 1,
        int: true,
        unit: "bars",
      },
      {
        t: "num",
        key: "within",
        label: "Crossed within",
        min: 1,
        max: 20,
        step: 1,
        int: true,
        unit: "bars",
      },
    ],
    defaults: { fast: 20, slow: 50, within: 3 },
  },
  {
    kind: "rsi",
    label: "RSI level",
    blurb:
      "The RSI oscillator is below (oversold - dip buy) or above (strong momentum) a threshold.",
    fields: [
      {
        t: "num",
        key: "period",
        label: "RSI period",
        min: 2,
        max: 50,
        step: 1,
        int: true,
        unit: "bars",
      },
      { t: "enum", key: "op", label: "RSI is", options: OP_ABOVE_BELOW },
      { t: "num", key: "value", label: "Threshold", min: 1, max: 99, step: 1 },
    ],
    defaults: { period: 14, op: "below", value: 30 },
  },
  {
    kind: "breakout",
    label: "Breakout of recent high",
    blurb:
      "Close breaks the highest high of the previous N bars by a small buffer - resistance is gone.",
    fields: [
      {
        t: "num",
        key: "lookback",
        label: "Lookback",
        min: 5,
        max: 200,
        step: 1,
        int: true,
        unit: "bars",
      },
      {
        t: "num",
        key: "buffer",
        label: "Buffer",
        min: 0,
        max: 2,
        step: 0.1,
        unit: "%",
      },
    ],
    defaults: { lookback: 20, buffer: 0.2 },
  },
  {
    kind: "bollinger",
    label: "Bollinger band position",
    blurb:
      "Close sits below the lower band (a rare dislocation to fade) or above the upper band (a strong push).",
    fields: [
      {
        t: "enum",
        key: "band",
        label: "Close is",
        options: [
          { value: "below_lower", label: "below the lower band" },
          { value: "above_upper", label: "above the upper band" },
        ],
      },
      {
        t: "num",
        key: "period",
        label: "Period",
        min: 5,
        max: 100,
        step: 1,
        int: true,
        unit: "bars",
      },
      {
        t: "num",
        key: "k",
        label: "Width",
        min: 1,
        max: 4,
        step: 0.1,
        unit: "σ",
      },
    ],
    defaults: { band: "below_lower", period: 20, k: 2 },
  },
  {
    kind: "volume",
    label: "Volume confirmation",
    blurb:
      "Current volume is at least a multiple of its recent average - real participation behind the move.",
    fields: [
      {
        t: "num",
        key: "mult",
        label: "At least",
        min: 1,
        max: 10,
        step: 0.1,
        unit: "× avg",
      },
      {
        t: "num",
        key: "period",
        label: "Average over",
        min: 5,
        max: 100,
        step: 1,
        int: true,
        unit: "bars",
      },
    ],
    defaults: { mult: 1.5, period: 20 },
  },
  {
    kind: "volatility",
    label: "Volatility gate (ATR)",
    blurb:
      "ATR as a % of price is above a floor (skip dead tape) or below a ceiling (skip chaos).",
    fields: [
      {
        t: "num",
        key: "period",
        label: "ATR period",
        min: 2,
        max: 50,
        step: 1,
        int: true,
        unit: "bars",
      },
      { t: "enum", key: "op", label: "ATR/price is", options: OP_ABOVE_BELOW },
      {
        t: "num",
        key: "value",
        label: "Threshold",
        min: 0.05,
        max: 10,
        step: 0.05,
        unit: "%",
      },
    ],
    defaults: { period: 14, op: "above", value: 0.5 },
  },
  {
    kind: "change",
    label: "Price change over N bars",
    blurb:
      "Percent move over a lookback window - demand momentum (above) or a pullback (below).",
    fields: [
      {
        t: "num",
        key: "lookback",
        label: "Over",
        min: 1,
        max: 200,
        step: 1,
        int: true,
        unit: "bars",
      },
      { t: "enum", key: "op", label: "Change is", options: OP_ABOVE_BELOW },
      {
        t: "num",
        key: "value",
        label: "Threshold",
        min: -50,
        max: 50,
        step: 0.5,
        unit: "%",
      },
    ],
    defaults: { lookback: 10, op: "above", value: 2 },
  },
  {
    kind: "confirm",
    label: "Candle confirmation",
    blurb:
      "Current close is above the previous bar's high - the bounce/move has already started (don't catch knives).",
    fields: [],
    defaults: {},
  },
];

export const RULE_SPEC: Record<string, RuleKindSpec> = Object.fromEntries(
  RULE_CATALOG.map((r) => [r.kind, r]),
);

export function newRule(kind: string): Rule {
  return { kind, ...RULE_SPEC[kind].defaults };
}

export const DEFAULT_EXITS: CustomExits = {
  stop_loss_pct: 0.03,
  take_profit_pct: 0.05,
  chandelier_k: 0,
  atr_period: 14,
  max_hold_bars: 0,
};

export const EXIT_FIELDS: NumField[] = [
  {
    t: "num",
    key: "stop_loss_pct",
    label: "Hard stop",
    min: 0.5,
    max: 20,
    step: 0.5,
    unit: "%",
  },
  {
    t: "num",
    key: "take_profit_pct",
    label: "Take-profit (0 = let it run)",
    min: 0,
    max: 50,
    step: 0.5,
    unit: "%",
  },
  {
    t: "num",
    key: "chandelier_k",
    label: "ATR trail (0 = off)",
    min: 0,
    max: 6,
    step: 0.5,
    unit: "× ATR",
  },
  {
    t: "num",
    key: "atr_period",
    label: "Trail ATR period",
    min: 2,
    max: 50,
    step: 1,
    int: true,
    unit: "bars",
  },
  {
    t: "num",
    key: "max_hold_bars",
    label: "Time-stop (0 = off)",
    min: 0,
    max: 500,
    step: 1,
    int: true,
    unit: "bars",
  },
];

export function defaultCustomDef(): CustomDef {
  return {
    v: CUSTOM_SCHEMA_VERSION,
    name: "My strategy",
    rules: [newRule("trend"), newRule("rsi"), newRule("confirm")],
    exits: { ...DEFAULT_EXITS },
  };
}

// ---------- plain-English rendering ----------

export function describeRule(r: Rule): string {
  switch (r.kind) {
    case "trend":
      return `price is ${r.op} its ${r.period}-bar SMA`;
    case "sma_cross":
      return `SMA(${r.fast}) crossed above SMA(${r.slow}) within the last ${r.within} bar${r.within === 1 ? "" : "s"}`;
    case "rsi":
      return `RSI(${r.period}) is ${r.op} ${r.value}`;
    case "breakout":
      return `close breaks the prior ${r.lookback}-bar high by ≥ ${r.buffer}%`;
    case "bollinger":
      return `close is ${r.band === "below_lower" ? "below the lower" : "above the upper"} Bollinger band (${r.period}, ${r.k}σ)`;
    case "volume":
      return `volume ≥ ${r.mult}× its ${r.period}-bar average`;
    case "volatility":
      return `ATR(${r.period}) is ${r.op} ${r.value}% of price`;
    case "change":
      return `price change over ${r.lookback} bars is ${r.op} ${r.value}%`;
    case "confirm":
      return "close is above the previous bar's high (confirmation)";
    default:
      return r.kind;
  }
}

export function describeExits(e: CustomExits): string {
  const parts = [`${(e.stop_loss_pct * 100).toFixed(1)}% hard stop`];
  if (e.take_profit_pct > 0)
    parts.push(`${(e.take_profit_pct * 100).toFixed(1)}% take-profit`);
  if (e.chandelier_k > 0)
    parts.push(`${e.chandelier_k}×ATR(${e.atr_period}) trail`);
  if (e.max_hold_bars > 0) parts.push(`${e.max_hold_bars}-bar time-stop`);
  return parts.join(" · ");
}

// ---------- evaluation (MUST match bot/strategies/custom.py) ----------

function num(r: Rule, key: string): number {
  return Number(r[key]);
}

function evalRule(
  r: Rule,
  candles: Candle[],
  closes: number[],
  end: number,
): boolean {
  switch (r.kind) {
    case "trend": {
      const m = sma(closes, end, num(r, "period"));
      if (m === null) return false;
      return r.op === "above" ? closes[end] > m : closes[end] < m;
    }
    case "sma_cross": {
      const fast = num(r, "fast"),
        slow = num(r, "slow"),
        within = num(r, "within");
      for (let j = 0; j < within; j++) {
        const e = end - j;
        if (e < 1) break;
        const af = sma(closes, e, fast),
          as = sma(closes, e, slow);
        const bf = sma(closes, e - 1, fast),
          bs = sma(closes, e - 1, slow);
        if (
          af !== null &&
          as !== null &&
          bf !== null &&
          bs !== null &&
          bf <= bs &&
          af > as
        )
          return true;
      }
      return false;
    }
    case "rsi": {
      const v = rsi(closes, end, num(r, "period"));
      if (v === null) return false;
      return r.op === "above" ? v > num(r, "value") : v < num(r, "value");
    }
    case "breakout": {
      const lookback = num(r, "lookback");
      if (end < lookback) return false;
      let hi = -Infinity;
      for (let i = end - lookback; i < end; i++)
        hi = Math.max(hi, candles[i].h);
      return hi > 0 && closes[end] >= hi * (1 + num(r, "buffer") / 100);
    }
    case "bollinger": {
      const period = num(r, "period"),
        k = num(r, "k");
      const m = sma(closes, end, period),
        sd = stdev(closes, end, period);
      if (m === null || sd === null || sd <= 0) return false;
      return r.band === "below_lower"
        ? closes[end] < m - k * sd
        : closes[end] > m + k * sd;
    }
    case "volume": {
      const av = avgVolume(candles, end - 1, num(r, "period"));
      return av !== null && candles[end].v >= num(r, "mult") * av;
    }
    case "volatility": {
      const a = atr(candles, end, num(r, "period"));
      if (a === null || closes[end] <= 0) return false;
      const frac = a / closes[end];
      const th = num(r, "value") / 100;
      return r.op === "above" ? frac > th : frac < th;
    }
    case "change": {
      const lookback = num(r, "lookback");
      if (end < lookback || closes[end - lookback] <= 0) return false;
      const chg =
        ((closes[end] - closes[end - lookback]) / closes[end - lookback]) * 100;
      return r.op === "above" ? chg > num(r, "value") : chg < num(r, "value");
    }
    case "confirm":
      return end >= 1 && candles[end].c > candles[end - 1].h;
    default:
      return false; // unknown rule -> never enter (same as custom.py)
  }
}

export function customEntryAt(
  def: CustomDef,
  candles: Candle[],
  closes: number[],
  end: number,
): boolean {
  if (def.rules.length === 0) return false;
  return def.rules.every((r) => evalRule(r, candles, closes, end));
}

export function toExitConfig(e: CustomExits): ExitConfig {
  return {
    stopLossPct: e.stop_loss_pct,
    takeProfitPct: e.take_profit_pct,
    chandelierK: e.chandelier_k,
    atrPeriod: e.atr_period,
    maxHoldBars: e.max_hold_bars,
  };
}

export function simulateCustom(def: CustomDef, candles: Candle[]): SimResult {
  return runSim(
    candles,
    (cs, closes, i) => customEntryAt(def, cs, closes, i),
    toExitConfig(def.exits),
  );
}

/** Longest indicator window in the def - bars before which nothing can fire. */
export function customWarmup(def: CustomDef): number {
  let w = 2;
  for (const r of def.rules) {
    for (const f of RULE_SPEC[r.kind]?.fields ?? []) {
      if (f.t === "num" && f.int) w = Math.max(w, Number(r[f.key]) + 1);
    }
  }
  return Math.max(w, def.exits.atr_period + 1);
}

/** Chart overlays for the levels the rules watch (SMAs, bands, breakout highs). */
export function customOverlays(
  def: CustomDef,
  candles: Candle[],
): OverlaySeries[] {
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const out: OverlaySeries[] = [];
  const seen = new Set<string>();
  const push = (s: OverlaySeries) => {
    if (out.length < 4 && !seen.has(s.name)) {
      seen.add(s.name);
      out.push(s);
    }
  };
  for (const r of def.rules) {
    if (r.kind === "trend") {
      push({
        name: `SMA(${r.period})`,
        points: smaSeries(closes, num(r, "period")),
        role: "secondary",
      });
    } else if (r.kind === "sma_cross") {
      push({
        name: `SMA(${r.fast})`,
        points: smaSeries(closes, num(r, "fast")),
        role: "primary",
      });
      push({
        name: `SMA(${r.slow})`,
        points: smaSeries(closes, num(r, "slow")),
        role: "secondary",
      });
    } else if (r.kind === "breakout") {
      push({
        name: `${r.lookback}-bar high`,
        points: priorHighSeries(highs, num(r, "lookback")),
        role: "primary",
      });
    } else if (r.kind === "bollinger") {
      const period = num(r, "period"),
        k = num(r, "k");
      const band = (sign: 1 | -1) =>
        closes.map((_, i) => {
          const m = sma(closes, i, period),
            sd = stdev(closes, i, period);
          return m !== null && sd !== null ? m + sign * k * sd : null;
        });
      push({ name: `BB upper (${k}σ)`, points: band(1), role: "primary" });
      push({ name: `BB lower (${k}σ)`, points: band(-1), role: "primary" });
    }
  }
  return out;
}

// ---------- validation (server-side gate; also used by the builder for messages) ----------

function clampField(f: NumField, v: unknown): number {
  let n = Number(v);
  if (!Number.isFinite(n)) n = f.min;
  n = Math.min(f.max, Math.max(f.min, n));
  return f.int ? Math.round(n) : Number(n.toFixed(6));
}

/** Validate + canonicalize a user-supplied definition. Throws with a human-readable
 *  message on structural problems; silently clamps out-of-range numbers. */
export function sanitizeCustomDef(input: unknown): CustomDef {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("Strategy definition is not valid JSON.");
    }
  }
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new Error("Strategy definition must be an object.");
  const raw = input as Record<string, unknown>;

  const name =
    String(raw.name ?? "")
      .replace(/[\r\n\t]/g, " ")
      .trim()
      .slice(0, 60) || "My strategy";

  if (!Array.isArray(raw.rules) || raw.rules.length === 0)
    throw new Error("Add at least one entry condition.");
  if (raw.rules.length > MAX_RULES)
    throw new Error(`At most ${MAX_RULES} conditions.`);
  const rules: Rule[] = raw.rules.map((r, i) => {
    if (r === null || typeof r !== "object")
      throw new Error(`Condition ${i + 1} is malformed.`);
    const rr = r as Record<string, unknown>;
    const spec = RULE_SPEC[String(rr.kind)];
    if (!spec)
      throw new Error(
        `Condition ${i + 1}: unknown block "${String(rr.kind)}".`,
      );
    const out: Rule = { kind: spec.kind };
    for (const f of spec.fields) {
      if (f.t === "num")
        out[f.key] = clampField(f, rr[f.key] ?? spec.defaults[f.key]);
      else {
        const v = String(rr[f.key] ?? spec.defaults[f.key]);
        out[f.key] = f.options.some((o) => o.value === v)
          ? v
          : String(spec.defaults[f.key]);
      }
    }
    return out;
  });

  // cross-field rules
  for (const r of rules) {
    if (r.kind === "sma_cross" && Number(r.fast) >= Number(r.slow)) {
      throw new Error(
        "SMA cross: the fast period must be below the slow period.",
      );
    }
  }
  // duplicate confirm blocks are pointless; drop extras
  const deduped: Rule[] = [];
  let confirmSeen = false;
  for (const r of rules) {
    if (r.kind === "confirm") {
      if (confirmSeen) continue;
      confirmSeen = true;
    }
    deduped.push(r);
  }

  const er = (raw.exits ?? {}) as Record<string, unknown>;
  // exits arrive as fractions in the stored def; EXIT_FIELDS bounds are in display units (%)
  const exits: CustomExits = {
    stop_loss_pct: clampFrac(
      er.stop_loss_pct,
      0.005,
      0.2,
      DEFAULT_EXITS.stop_loss_pct,
    ),
    take_profit_pct: clampFrac(
      er.take_profit_pct,
      0,
      0.5,
      DEFAULT_EXITS.take_profit_pct,
    ),
    chandelier_k: clampNum(er.chandelier_k, 0, 6, DEFAULT_EXITS.chandelier_k),
    atr_period: Math.round(
      clampNum(er.atr_period, 2, 50, DEFAULT_EXITS.atr_period),
    ),
    max_hold_bars: Math.round(
      clampNum(er.max_hold_bars, 0, 500, DEFAULT_EXITS.max_hold_bars),
    ),
  };
  if (
    exits.take_profit_pct === 0 &&
    exits.chandelier_k === 0 &&
    exits.max_hold_bars === 0
  ) {
    // only a hard stop = positions can linger forever with no upside exit; require one more
    throw new Error(
      "Add at least one non-stop exit: a take-profit, an ATR trail, or a time-stop.",
    );
  }

  return { v: CUSTOM_SCHEMA_VERSION, name, rules: deduped, exits };
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function clampFrac(v: unknown, lo: number, hi: number, dflt: number): number {
  return Number(clampNum(v, lo, hi, dflt).toFixed(6));
}

/** Parse a stored params JSON into a def (for display); returns null when invalid. */
export function parseCustomDef(paramsJson: string | null): CustomDef | null {
  if (!paramsJson) return null;
  try {
    return sanitizeCustomDef(paramsJson);
  } catch {
    return null;
  }
}
