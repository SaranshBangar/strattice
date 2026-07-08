// Human-facing metadata for strategy templates. The engine keys off the template
// id; this is purely for the UI so users aren't picking from raw snake_case ids.
// Entry/exit text mirrors bot/strategies/*.py + worker/config_gen.py stock params
// (the DAILY defaults validated in research/FINDINGS.md - the engine trades 1d bars).
import type { Template } from "./entitlements";

export interface StrategyMeta {
  label: string;
  kind: string; // short tag: TREND / MOMENTUM / MEAN-REV / ...
  blurb: string; // one line, what it does
  entry: string; // when the strategy buys (stock params)
  exit: string; // how the engine's protective layer gets it out
  style: string; // holding style, one line
  explain: string[]; // long-form: how it works, why it works, when it struggles
  /** Rendered as a prominent risk callout wherever the template is shown. */
  warning?: string;
}

export const STRATEGY_META: Record<Template, StrategyMeta> = {
  tsmom: {
    label: "Time-Series Momentum",
    kind: "TREND",
    blurb:
      "Buys strength near recent highs - the most robust documented crypto edge.",
    entry:
      "Price is up ≥ 10% over the last 30 days, closes within 2% of the 30-day high, and sits above its 50-day regime SMA.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop. No take-profit - winners are left to run.",
    style:
      "Patient trend rider. A handful of trades per year; holds winners for weeks.",
    explain: [
      "Time-series momentum is the simplest fact in the trend-following literature: assets that have gone up meaningfully over the last month tend to keep going up. This template buys strength - not dips - and only when that strength is fresh.",
      "Three gates keep it honest. The 30-day return must exceed 10% (real momentum, not drift). The close must sit within 2% of the 30-day high - if price is already rolling over, the move is fading and you'd be buying someone else's exit. And the regime filter (price above its 50-day average) confirms the uptrend context.",
      "There is deliberately no take-profit. The whole edge is the fat right tail: a few large winners pay for everything, including India's ~1.5-1.7% round-trip friction. The exit is a chandelier trail 3.5×ATR below the highest close since entry, plus a 7% disaster stop.",
      "Backtested on real CoinDCX daily data (2023-2026): +207.6% net of all fees and TDS on ETH/INR, profit factor 2.58, positive in 17 of 21 rolling out-of-sample folds. It goes quiet in bear markets and choppy ranges - that silence is the regime filter doing its job.",
    ],
  },
  momentum: {
    label: "Momentum Breakout",
    kind: "MOMENTUM",
    blurb: "Buys fresh breakouts of the 20-day high on real volume.",
    entry:
      "Close breaks the prior 20-day high by ≥ 0.2% (but < 5% - no chasing) on ≥ 1× average volume, with ATR ≥ 1% of price and the 50-day regime SMA below.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop. No take-profit.",
    style: "Classic Donchian breakout rider on daily bars.",
    explain: [
      "When price clears its highest point of the last 20 days, everyone who bought in that window is in profit and nobody is trapped waiting to sell at break-even - resistance is gone. That structural fact, not a prediction, is the edge a Donchian-style breakout trades.",
      "Most breakouts fail, so the template demands proof before committing: volume at least equal to its 20-day average (real participation), ATR above 1% of price (dead tape produces fake breakouts), a 0.2% buffer over the old high, and a 5% chase cap so you never buy the top of a spike - daily gaps are bigger than intraday ones, hence the wider cap.",
      "Exits are pure trend-following: no target, a 3.5×ATR chandelier trail, and a 7% hard stop sized for daily-bar noise.",
      "Backtested on real CoinDCX daily data (2023-2026): +108.7% net on BTC/INR, profit factor 2.75, positive in 16 of 21 rolling out-of-sample folds. Expect a modest win rate - the few breakouts that run for weeks pay for the many that stall out.",
    ],
  },
  squeeze_breakout: {
    label: "Squeeze Breakout",
    kind: "BREAKOUT",
    blurb:
      "Waits for a volatility squeeze, then trades the breakout with volume.",
    entry:
      "Bollinger bands compress inside the Keltner channel (squeeze) within the last 6 days, then price breaks the prior 20-day high by ≥ 0.2% on ≥ 1× average volume, in an uptrend.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop. No take-profit.",
    style:
      "Coil-and-release on daily bars. The best walk-forward record of the backtest study.",
    explain: [
      "Volatility is cyclical: quiet periods are compressed springs. The TTM-squeeze idea detects the compression by comparing two envelopes - when the Bollinger bands (driven by close-to-close variance) squeeze inside the Keltner channel (driven by true range), the market is unusually coiled.",
      "The squeeze itself has no direction; it only says a move is loading. Direction comes from the breakout: within 6 days of a squeeze, price must clear the prior 20-day high with the same discipline as the Momentum template - 0.2% buffer, 5% chase cap, volume at least average, ATR floor.",
      "A breakout born from compression is statistically better than a random breakout - the energy for the follow-through was visibly stored. Exits are pure trend-following: a 3.5×ATR chandelier trail, 7% hard stop, no target.",
      "Backtested on real CoinDCX daily data (2023-2026): +138.9% net on DOGE/INR, profit factor 2.85, and positive in 18 of 21 rolling out-of-sample folds - the best fold record of the whole study.",
    ],
  },
  ma_crossover: {
    label: "MA Crossover",
    kind: "TREND",
    blurb:
      "Buys when the 8-day average crosses above the 25-day; the trail takes care of the exit.",
    entry:
      "Fast SMA(8) crosses above slow SMA(25) within the last 3 days with the gap ≥ 0.2×ATR, the slow MA rising, and price above its 100-day regime SMA.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop. No take-profit - winners are left to run.",
    style:
      "Patient trend-follower. Few entries; holds winners for weeks to months.",
    explain: [
      "A moving average smooths price over a window: the 8-day average reacts quickly, the 25-day average slowly. When the fast average climbs above the slow one, recent prices are decisively higher than older prices - the classic definition of a new uptrend.",
      "The naive version of this strategy gets destroyed by whipsaws: in sideways chop the averages cross back and forth and every crossing pays fees. This template kills the churn three ways - the fast average must clear the slow one by at least 0.2×ATR (a real gap, not a graze), the slow average itself must be rising, and price must sit above its 100-day regime average so you only ever buy into strength.",
      "There is deliberately no take-profit. Trend-following makes its money on a few large winners, so the exit is a chandelier trail that follows the highest price up at a distance of 3.5×ATR - the trade stays open while the trend breathes normally and closes only when it breaks. A 7% hard stop caps the damage when the entry is simply wrong.",
      "Backtested on real CoinDCX daily data (2023-2026): +187.7% net on XRP/INR, profit factor 2.25 (USDT twin +109.8%). It struggles in ranging markets and gives back part of every big winner - the trail exits after the peak, by design. Judge it over months, not days.",
    ],
  },
  vol_expansion: {
    label: "Volatility Expansion",
    kind: "VOLATILITY",
    blurb:
      "Enters when volatility pops out of a quiet range at a new local high.",
    entry:
      "5-day ATR expands to ≥ 1.3× the 20-day ATR and price prints a new 10-day closing high, above the 50-day regime SMA.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop.",
    style: "Expansion trader. Fires on regime shifts from quiet to loud.",
    explain: [
      "Markets alternate between quiet and loud regimes, and the transition is tradeable: when the short-window ATR (5 days) expands to 1.3× the long-window ATR (20 days), something just changed - news, a large buyer, a broken level. Volatility arriving is information.",
      "Direction comes from the second condition: the expansion must coincide with a new 10-day closing high, in an uptrend. Volatility with an upward resolution is an entry; volatility alone is just noise.",
      "The ATR that widened to trigger the entry also widens the chandelier trail, so the exit automatically gives a violent move more room - then the 7% hard stop is the disaster brake.",
      "Backtested on real CoinDCX daily data (2023-2026): +143.6% net on BNB/INR, profit factor 2.75 (USDT twin +171.9%), with 78 of 81 tested parameter combinations positive - the widest, most forgiving parameter plateau of the study.",
    ],
  },
  supertrend: {
    label: "Supertrend",
    kind: "TREND",
    blurb:
      "Rides the classic ATR-band trend indicator; buys fresh flips from down to up.",
    entry:
      "The supertrend state (median price ± 3×ATR(10), ratcheting) flips from down to up within the last 2 days, with price above its 50-day regime SMA.",
    exit: "ATR chandelier trail (3.5×ATR(14) off the peak) plus a 7% hard stop. No take-profit.",
    style: "Structured trend rider - one clean signal per trend leg.",
    explain: [
      "Supertrend draws a band a fixed multiple of ATR away from the median price, and lets it ratchet: while the trend is up the band (below price) may only rise; while it's down the band (above price) may only fall. Price crossing the active band flips the trend state. It's the same logic as the chandelier exit, applied symmetrically to entries.",
      "This template buys only a FRESH flip to up - within the last 2 days - so it fires once per trend leg. Buying a stale up-state weeks into a move would just be chasing; the freshness rule and the 50-day regime filter keep entries at the start of legs, where the trail has the most room to work.",
      "Because the band is ATR-scaled, the entry automatically adapts: a volatile market needs a bigger reversal to flip the state, a quiet one a smaller one. Exits are the shared trend-following layer - 3.5×ATR chandelier, 7% hard stop, no target.",
      "Backtested on real CoinDCX daily data (2023-2026): positive on 7 of 7 INR pairs (BTC/INR +94.6%, twin +21.8%), positive median across the entire tested parameter plateau, and 15 of 21 rolling out-of-sample folds positive.",
    ],
  },
  rsi: {
    label: "RSI Reversion",
    kind: "MEAN-REV",
    blurb: "Retired: buys deeply oversold dips - loses net of India friction.",
    entry:
      "RSI(14) drops below 22 in an uptrend, then a candle closes back above the prior bar's high (confirmation).",
    exit: "3% take-profit, 3% hard stop, or a 64-bar time-stop - whichever comes first.",
    style: "Retired mean-reversion dip-buyer.",
    warning:
      "Retired after the backtest study (research/FINDINGS.md): mean-reversion's many small wins are exactly the shape that India's 1% TDS per sell taxes to death. It lost money net of friction at every tested timeframe - including daily. Existing copies keep their exits managed, but this template is no longer offered and we recommend replacing it with a trend template.",
    explain: [
      "RSI (Relative Strength Index) measures how one-sided recent bars were: near 100 every bar closed up, near 0 every bar closed down. A very low RSI inside a healthy uptrend is usually a temporary overreaction - and buying the confirmed bounce back was the idea here.",
      "The full real-data study retired it: at 15m it lost ~3.5% median across 14 markets, and at daily altitude the gates essentially never align (zero trades on most pairs). Small, frequent wins cannot outrun a ~1.5-1.7% round-trip toll.",
    ],
  },
  fast_rsi: {
    label: "Fast RSI",
    kind: "MEAN-REV",
    blurb: "Retired: a quicker RSI dip-buyer - loses net of India friction.",
    entry:
      "RSI(7) drops below 25 in an uptrend, then a candle closes back above the prior bar's high (confirmation).",
    exit: "2.5% take-profit, 2% hard stop, or a 12-bar time-stop - whichever comes first.",
    style: "Retired fast mean-reversion.",
    warning:
      "Retired after the backtest study (research/FINDINGS.md): it lost 28.6% median at 15m and 6.8% at daily across 14 real markets, net of fees and TDS. More trades means more friction, and the friction is the whole story. Existing copies keep their exits managed, but this template is no longer offered.",
    explain: [
      "The same logic as RSI Reversion on a twitchier 7-bar RSI: more entries, tighter exits, shorter holds.",
      "That higher trade count is exactly why it failed: every round trip pays ~1.5-1.7% in fees and TDS, and fast mean-reversion's small average win never covered it on any tested market or timeframe.",
    ],
  },
  bb_reversion: {
    label: "Bollinger Reversion",
    kind: "MEAN-REV",
    blurb: "Retired: fades 2σ dislocations - loses net of India friction.",
    entry:
      "Prior bar closes ≥ 2σ below the 20-bar Bollinger mid; the current bar closes back inside the band.",
    exit: "4% take-profit, 3% hard stop, or a 32-bar time-stop - whichever comes first.",
    style: "Retired dislocation fader.",
    warning:
      "Retired after the backtest study (research/FINDINGS.md): the worst performer of the retired lineup (-54.2% median at 15m; still negative re-tested at daily). Snap-back wins are small by construction and India's per-sell TDS makes them net-negative. Existing copies keep their exits managed, but this template is no longer offered.",
    explain: [
      "Bollinger bands draw a statistical envelope around price; closing 2σ below it is rare, and this strategy traded the tendency of such dislocations to snap back once the reversal had visibly begun.",
      "The edge is real gross of costs and negative net of them: the average snap-back is a few percent at best, and ~1.5-1.7% of that goes to fees and TDS on every round trip. The study retired it at every tested altitude.",
    ],
  },
  hf_forecast: {
    label: "AI Forecast",
    kind: "AI · EXPT",
    blurb:
      "Asks Chronos-2 - Amazon's time-series foundation model - whether the next few days look up, and buys only on a confident yes.",
    entry:
      "Chronos-2 forecasts the next 8 daily bars from the last 512 closes. Buy when the forecast median is ≥ 3% above the current price, the forecast lower band (q10) is not below it, and the market is in an uptrend (100-day SMA).",
    exit: "8% take-profit, 5% hard stop, or a 16-day time-stop - whichever comes first.",
    style:
      "Experimental ML signal. Trades rarely; every entry needs the model, the trend and the cost gate to agree.",
    warning:
      "Experimental — no proven edge. This strategy trades on a machine-learning forecast from a general-purpose model that was never trained specifically on crypto markets. Crypto price at these horizons is close to a random walk: the model can be confidently wrong, especially around news, crashes and regime changes, and no backtest here is long enough to prove (or disprove) an edge. There is no browser preview because inference runs only inside the bot. Run it in DRY_RUN first, size it as a small slice of a portfolio, and never as your only strategy. The stop-loss and time-stop are the real safety net, not the model.",
    explain: [
      "Chronos-2 (amazon/chronos-2 on Hugging Face, Apache-2.0) is a 120M-parameter time-series foundation model - a transformer pretrained on millions of series that produces probabilistic forecasts for any numeric sequence. As of 2026 it is the top zero-shot forecaster on the public fev-bench and GIFT-Eval benchmarks. The strategy feeds it recent daily closes and reads back quantiles of where price might be about a week ahead. If the model can't be loaded, the bot automatically falls back to the much smaller chronos-bolt-tiny, and if no model is available it simply never trades.",
      "The entry demands agreement, not just a bullish median. The median forecast must clear 3% (well above round-trip friction), the pessimistic q10 band must not sit below the entry price (the model itself sees limited downside), and the shared regime gate must confirm an uptrend. Any single miss means HOLD.",
      "Exits are deliberately conventional and horizon-matched - +8% target, -5% stop, 16-day time-stop - because the forecast is only trusted for the window it was asked about. Nothing rides on the model being right for long.",
      "Honest framing: published research finds pretrained forecasters rarely beat simple baselines on raw crypto prices. This template exists to let you test that claim safely on your own account, not because the edge is established. Watch its net numbers over weeks in DRY_RUN before giving it real capital.",
    ],
  },
  custom: {
    label: "Custom Strategy",
    kind: "CUSTOM",
    blurb:
      "Your own entry rules and exits, built block by block in the strategy builder.",
    entry:
      "Whatever conditions you compose in the builder - all must be true on the same bar.",
    exit: "The stop-loss / take-profit / ATR trail / time-stop you configure.",
    style: "Yours. Backtest it across windows before enabling it live.",
    explain: [
      "Custom strategies are built from the same indicator blocks the stock templates use - trend filters, RSI, breakouts, Bollinger bands, volume and volatility gates - combined with AND logic and run by the same risk-managed engine.",
      "Build one in the strategy builder: every change re-simulates instantly on real candles and across multiple history windows, so you see the entries, exits and net-of-fees results while you design. The engine trades DAILY bars - the backtest study found that at India's ~1.5-1.7% round-trip friction, daily trend-following is the only altitude that stays net-positive, so judge your design on the 1d window first.",
    ],
  },
};

/** DCA (recurring buy) - PREVIEW ONLY. Deliberately NOT in STRATEGY_META: the
 *  Python engine has no DCA strategy yet, so it must not be addable/enable-able
 *  live (and the Template key space is parity-checked against the worker).
 *  Surfaced via the DcaPreview simulator on the strategies page. */
export const DCA_META: StrategyMeta = {
  label: "Recurring Buy (DCA)",
  kind: "ACCUMULATE",
  blurb:
    "Buys a fixed amount on a schedule, whatever the price - the simplest way to build a position without timing anything.",
  entry:
    "Every week (or the schedule you pick), buy a fixed rupee amount at that day's close. No signals, no indicators.",
  exit: "None - DCA accumulates. You decide if and when to sell.",
  style:
    "Set-and-forget accumulation. Judged over months and years, not trades.",
  warning:
    "Preview only for now - the trading engine cannot run DCA live yet. And be clear about what DCA is: it averages your entry price, it does not avoid losses. If the asset falls and stays down, a DCA position is down too. Every future sell still pays exchange fees, GST and 1% TDS, and gains are taxed at 30% (India VDA rules, losses not offsettable).",
  explain: [
    "Rupee-cost averaging buys the same amount on a fixed schedule, so you automatically buy more units when price is low and fewer when it is high. Your average cost tracks the market's average level instead of one lucky or unlucky day.",
    "Its real advantage is behavioral, not mathematical: no timing decisions, no chasing, no waiting for a dip that never comes. Against a lump sum invested on day one, DCA wins when the market falls after you start and loses when it rises - it is a way of spreading regret, not a source of edge.",
    "The simulator shows contributions vs mark-to-market value on real candles, net of buy-side friction on every purchase, and what you would keep after sell-side friction (including 1% TDS) if you sold at the last close. Simulated history is not a promise of future results.",
  ],
};

export function strategyLabel(template: string): string {
  return STRATEGY_META[template as Template]?.label ?? template;
}
