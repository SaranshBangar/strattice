// Human-facing metadata for strategy templates. The engine keys off the template
// id; this is purely for the UI so users aren't picking from raw snake_case ids.
// Entry/exit text mirrors bot/strategies/*.py + worker/config_gen.py stock params.
import type { Template } from "./entitlements";

export interface StrategyMeta {
  label: string;
  kind: string; // short tag: TREND / MOMENTUM / MEAN-REV / ...
  blurb: string; // one line, what it does
  entry: string; // when the strategy buys (stock params)
  exit: string; // how the engine's protective layer gets it out
  style: string; // holding style, one line
  explain: string[]; // long-form: how it works, why it works, when it struggles
}

export const STRATEGY_META: Record<Template, StrategyMeta> = {
  ma_crossover: {
    label: "MA Crossover",
    kind: "TREND",
    blurb: "Buys when a fast moving average crosses above a slow one; the trail takes care of the exit.",
    entry: "Fast SMA(32) crosses above slow SMA(96) with the gap ≥ 0.5×ATR, the slow MA rising, and price above its 192-bar regime SMA.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit - winners are left to run.",
    style: "Patient trend-follower. Few entries; holds winners for days to weeks.",
    explain: [
      "A moving average smooths price over a window: the 32-bar average reacts quickly, the 96-bar average slowly. When the fast average climbs above the slow one, recent prices are decisively higher than older prices - the classic definition of a new uptrend.",
      "The naive version of this strategy gets destroyed by whipsaws: in sideways chop the averages cross back and forth and every crossing pays fees. This template kills the churn three ways - the fast average must clear the slow one by at least half an ATR (a real gap, not a graze), the slow average itself must be rising, and price must sit above its long regime average so you only ever buy into strength.",
      "There is deliberately no take-profit. Trend-following makes its money on a few large winners, so the exit is a chandelier trail that follows the highest price up at a distance of 3×ATR - the trade stays open while the trend breathes normally and closes only when it breaks. A 4% hard stop caps the damage when the entry is simply wrong.",
      "It struggles in ranging markets (no trend to follow, occasional small losses) and gives back part of every big winner - the trail exits after the peak, by design. Judge it over months, not days.",
    ],
  },
  rsi: {
    label: "RSI Reversion",
    kind: "MEAN-REV",
    blurb: "Buys deeply oversold dips in an uptrend and sells the bounce.",
    entry: "RSI(14) drops below 22 while price is above its 192-bar regime SMA, then a candle closes back above the prior bar's high (confirmation).",
    exit: "3% take-profit, 3% hard stop, or a 64-bar time-stop - whichever comes first.",
    style: "Conservative dip-buyer. Small, frequent-ish mean-reversion trades.",
    explain: [
      "RSI (Relative Strength Index) measures how one-sided the last 14 bars were: near 100 every bar closed up, near 0 every bar closed down. A very low RSI means sellers have been relentlessly in control - which, inside a healthy uptrend, is usually a temporary overreaction rather than the start of a collapse.",
      "The threshold here is a deep 22, not the textbook 30 - shallow dips don't clear real-world costs. Two gates keep it honest: the regime filter (price above its 192-bar average) means you only buy dips in markets that are going up, and the confirmation rule (a candle closing back above the previous bar's high) means you buy the bounce after it starts, never the falling knife.",
      "Mean-reversion profits are small and quick, so the exits are symmetric and tight: +3% target, -3% stop, and a time-stop that frees the capital if the bounce never comes. Hit rate matters more than trade size for this style.",
      "It struggles when a dip is actually a regime change - the stop handles that - and it goes quiet in flat markets where RSI never reaches 22. Silence is the filter working, not a bug.",
    ],
  },
  momentum: {
    label: "Momentum Breakout",
    kind: "MOMENTUM",
    blurb: "Buys fresh breakouts of the recent high on real volume.",
    entry: "Close breaks the prior 32-bar high by ≥ 0.2% (but < 2% - no chasing) on ≥ 1.2× average volume, with ATR above its volatility floor.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit.",
    style: "Breakout rider. Waits for participation, then follows the move.",
    explain: [
      "When price clears its highest point of the last 32 bars, everyone who bought in that window is in profit and nobody is trapped waiting to sell at break-even - resistance is gone. That structural fact, not a prediction, is the edge a Donchian-style breakout trades.",
      "Most breakouts fail, so the template demands proof before committing: volume at least 1.2× its recent average (real participation, not a quiet drift over the line), ATR above a volatility floor (dead tape produces fake breakouts), a 0.2% buffer over the old high (no rounding-error entries), and a 2% chase cap so you never buy the top of a spike.",
      "Exits mirror the MA Crossover: no target, a 3×ATR chandelier trail, and a 4% hard stop. Breakout profits come from the occasional move that keeps going for weeks; the trail is what lets those happen.",
      "Expect a modest win rate - many breakouts stall and trail out flat or slightly down. The strategy is profitable when the few that run pay for the many that don't, which is why the chase cap and volume gate matter so much.",
    ],
  },
  vol_expansion: {
    label: "Volatility Expansion",
    kind: "VOLATILITY",
    blurb: "Enters when volatility pops out of a quiet range at a new local high.",
    entry: "8-bar ATR expands to ≥ 1.6× the 32-bar ATR and price prints a new 24-bar closing high, in an uptrend.",
    exit: "ATR chandelier trail (2.5×ATR off the peak) plus a 2.5% hard stop.",
    style: "Aggressive expansion trader. Fires on regime shifts from quiet to loud.",
    explain: [
      "Markets alternate between quiet and loud regimes, and the transition is tradeable: when the short-window ATR (8 bars) blows out to 1.6× the long-window ATR (32 bars), something just changed - news, a large buyer, a broken level. Volatility arriving is information.",
      "Direction comes from the second condition: the expansion must coincide with a new 24-bar closing high, in an uptrend. Volatility with an upward resolution is an entry; volatility alone is just noise.",
      "Because expansion moves are sharper and shorter than slow trends, the exits are tighter than the trend templates: a 2.5×ATR trail and a 2.5% hard stop. Note the subtlety - the ATR that widened to trigger the entry also widens the trail, so the exit automatically gives a violent move more room.",
      "This is the most aggressive template: more entries, faster exits, more small losses. It earns its keep in regime shifts and loses small amounts waiting for them.",
    ],
  },
  fast_rsi: {
    label: "Fast RSI",
    kind: "MEAN-REV",
    blurb: "A quicker RSI dip-buyer for shorter, sharper reversion trades.",
    entry: "RSI(7) drops below 25 in an uptrend, then a candle closes back above the prior bar's high (confirmation).",
    exit: "2.5% take-profit, 2% hard stop, or a 12-bar time-stop - whichever comes first.",
    style: "Fast in, fast out. More entries, tighter exits than RSI Reversion.",
    explain: [
      "The same logic as RSI Reversion - buy confirmed dips inside an uptrend - but on a 7-bar RSI instead of 14. A shorter window makes the oscillator twitchier: it reaches oversold more often, so the strategy trades more and holds for less time.",
      "The threshold is loosened to 25 and the regime filter shortened to 96 bars, both consistent with the faster clock. The confirmation rule is unchanged and non-negotiable: the current candle must close back above the prior bar's high before any buy.",
      "Exits are compressed to match: +2.5% target, -2% stop, and a hard 12-bar time-stop. On 15-minute candles that's a three-hour maximum hold - capital never sits in a trade that isn't working.",
      "More trades means more total friction, which is the real risk here: at ~1.5% round-trip cost, a marginal fast-reversion setup loses money on fees alone. Watch the net (post-friction) numbers in the preview, not the gross.",
    ],
  },
  bb_reversion: {
    label: "Bollinger Reversion",
    kind: "MEAN-REV",
    blurb: "Fades ≥2σ stretches below the Bollinger band once price snaps back inside.",
    entry: "Prior bar closes ≥ 2σ below the 20-bar Bollinger mid; the current bar closes back inside the band (buy the reversion, not the knife).",
    exit: "4% take-profit, 3% hard stop, or a 32-bar time-stop - whichever comes first.",
    style: "Dislocation fader. Rare, high-conviction snap-back entries.",
    explain: [
      "Bollinger bands draw a statistical envelope around price: the 20-bar average ± 2 standard deviations. Price closing below the lower band is, by construction, a rare event - roughly the 2.5% tail if returns were normal. This strategy trades the tendency of such dislocations to snap back toward the average.",
      "The two-bar structure is the whole trick. Bar one must close a full 2σ below the mid - a genuine dislocation, not a wobble. Bar two must close back inside the band - the snap-back has already begun. Buying on bar one is catching a falling knife; buying on bar two is joining a reversal in progress. The regime filter additionally requires the dislocation to happen inside an uptrend.",
      "The exits are asymmetric in your favor: +4% target against a -3% stop, because a true 2σ snap-back tends to travel. A 32-bar time-stop cleans up the trades that just sit there.",
      "Setups are rare - a few per month per market is normal. When it fires without an uptrend context or during a genuine crash, the stop is what saves you; that's why it's sized as one strategy in a portfolio, not the whole portfolio.",
    ],
  },
  squeeze_breakout: {
    label: "Squeeze Breakout",
    kind: "BREAKOUT",
    blurb: "Waits for a volatility squeeze, then trades the breakout with volume.",
    entry: "Bollinger bands compress inside the Keltner channel (squeeze), then price breaks the prior 20-bar high by ≥ 0.2% on ≥ 1.2× average volume.",
    exit: "ATR chandelier trail (3×ATR off the peak) plus a 4% hard stop. No take-profit.",
    style: "Coil-and-release. Low-volatility compression before the expansion move.",
    explain: [
      "Volatility is cyclical: quiet periods are compressed springs. The TTM-squeeze idea detects the compression by comparing two envelopes - when the Bollinger bands (driven by close-to-close variance) squeeze inside the Keltner channel (driven by true range), the market is unusually coiled.",
      "The squeeze itself has no direction; it only says a move is loading. Direction comes from the breakout: within 6 bars of a squeeze, price must clear the prior 20-bar high with the same discipline as the Momentum template - 0.2% buffer, 2% chase cap, 1.2× volume, ATR floor.",
      "A breakout born from compression is statistically better than a random breakout - the energy for the follow-through was visibly stored. Exits are pure trend-following: a 3×ATR chandelier trail, 4% hard stop, no target.",
      "The failure mode is a squeeze that resolves downward or fizzles - the regime filter blocks most of the former, the stop and trail contain the rest. Like every breakout system, a handful of runners pays for the duds.",
    ],
  },
  custom: {
    label: "Custom Strategy",
    kind: "CUSTOM",
    blurb: "Your own entry rules and exits, built block by block in the strategy builder.",
    entry: "Whatever conditions you compose in the builder - all must be true on the same bar.",
    exit: "The stop-loss / take-profit / ATR trail / time-stop you configure.",
    style: "Yours. Backtest it across windows before enabling it live.",
    explain: [
      "Custom strategies are built from the same indicator blocks the stock templates use - trend filters, RSI, breakouts, Bollinger bands, volume and volatility gates - combined with AND logic and run by the same risk-managed engine.",
      "Build one in the strategy builder: every change re-simulates instantly on live candles and across four history windows, so you see the entries, exits and net-of-fees results while you design.",
    ],
  },
};

export function strategyLabel(template: string): string {
  return STRATEGY_META[template as Template]?.label ?? template;
}
