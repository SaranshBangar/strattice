# Strategy review: backtest findings (July 2026)

> **v7 addendum (mid-July 2026, `strattice-hardening-upgrade`)** — a PORTFOLIO-level
> study (`research/portfolio_study.py`: all seven v6 sleeves replayed JOINTLY over the
> aligned INR daily history with shared cash, sleeve sizing, and the full cost model;
> re-run on the USDT twins for venue robustness; 200-bar walk-forward folds with the
> portfolio restarted flat per fold). Baseline (equal weights): **+216.7%** net,
> max DD 22.5%, PF 3.50, WF folds [+46.1, +87.2, +21.9, −6.2] (3/4). USDT twin
> baseline: +89.8%, DD 34.0%, folds [+25.8, +63.2, −2.9, −17.8].
>
> **PROMOTED (default-on): BTC 100-day trend overlay** (`portfolio.btc_regime_filter`,
> `entry_mult: 0.0` — block NEW entries while BTC closes under its 100d SMA; exits
> never touched; fails open if the BTC feed is unusable):
>
> | Venue | Net | Max DD | PF | WF worst fold | WF compounded |
> | ----- | ---: | ---: | ---: | ---: | ---: |
> | INR baseline  | +216.7% | 22.5% | 3.50 | −6.2%  | +212.7% |
> | INR + overlay | **+239.7%** | 22.2% | **4.57** | **−1.7%** | **+234.3%** |
> | USDT baseline | +89.8%  | 34.0% | 2.13 | −17.8% | — |
> | USDT + overlay| **+102.9%** | **29.4%** | **2.54** | **−11.8%** | +75.8% |
>
> Better on every metric on BOTH venues, and monotone (half-size `entry_mult: 0.5`
> also beats baseline on both venues; full-block dominates). The mechanism is the
> lineup's own correlation: mean pairwise daily-return correlation across the seven
> INR pairs is **0.58** (0.39 XRP/BNB … 0.71 ETH/BTC) — the sleeves are largely one
> crypto-beta trade, and BTC below its 100d line marks the regime where fresh longs
> in that bucket underperform. The 100d line is the tested edge (v6 already rejected
> the 150d variant for regime timing).
>
> **Exposed but DEFAULT-OFF (evidence says neutral or a trade-off, not an upgrade):**
>
> - `risk.max_new_entries_per_day` (per-day new-entry cap, correlation staggering):
>   cap=1 → +214.8% / DD 22.3% / WF worst −4.9% — within noise of baseline, slightly
>   better tail. cap=2 ≈ baseline exactly. Off; use it if same-day beta lumps bother you.
> - same-day 1/√k entry scaling was studied (+236.3% but DD 24.0% — takes MORE risk via
>   later compounding) and NOT implemented in the engine: rejected, reproducible in the
>   study harness.
> - `vol_target_ann` (per-sleeve vol-targeted sizing): 0.40 → +166.0% / **DD 19.0%** /
>   fees 17.2% (vs 24.7%), WF 3/4. A genuine risk dial — trades ~50pts of net for a
>   3.5pt shallower DD; 0.60 ≈ neutral (+211%, DD 21.7). Off by default.
> - `reentry_cooldown_bars` (cooldown after a stop-out): 2 and 5 bars are both ≈
>   baseline (±1pt) — at daily cadence the lineup rarely re-enters immediately after a
>   stop anyway. Harmless hygiene knob, off.
> - `exit_ladder_frac` (regime engines: sell a fraction at a 3.5×ATR trail, ride the
>   rest to the engine's own exit): frac=0.5 → +218.1% / **DD 20.4%** (INR), +95.1% /
>   DD 32.8% (USDT twin) — DD down on both venues, net neutral, WF unchanged. A valid
>   opt-in for regime_doge / ichimoku_ada; off because it doesn't beat baseline
>   walk-forward (the bar for changing defaults).
> - `risk.max_consecutive_losses_halt`: **N=3 is destructive** (+46.4%: after three
>   straight losses it blocks entries, and with no entries there is no win to reset the
>   streak — a deadlock by construction); N=5 ≈ baseline minus a fold. Shipped as an
>   off-by-default manual-review TRIPWIRE (bugs, venue breakage), never a performance
>   feature. Protective exits always pass it.
> - `risk.asset_buckets` + `risk.exposure_caps` (correlation-bucket exposure cap): off
>   unless configured; the 0.58 mean pairwise correlation above is the evidence that
>   all seven sleeves belong to one "crypto" bucket if you choose to bound it.
> - `entry_slippage_cap_pct` (skip an entry whose live price ran past the signal
>   close): live-only guard, backtest-neutral by construction — a capped entry simply
>   re-signals on later polls/bars while its condition holds; the backtest already
>   assumes fills at close+5bps, so this bounds precisely the drift the model never
>   priced. Suggested 0.03 if used.
>
> **REJECTED: intraday crash brake as a default** (`engine.crash_brake`, gated OFF).
> Checking the 7%/10% hard stop against intraday lows (gap-aware: fills at the open
> when a bar opens through the stop) costs **−107pts net** (+109.5% vs +216.7%) and
> DEEPENS max DD to 27.6% (33 intraday stop-outs, win rate 45→32%): daily-bar trend
> positions routinely trade through the stop intraday and recover by the close, which
> is exactly why v3 chose close-based stops. The flag exists (with the cooldown combo
> +115.9% — still far under baseline) for operators who want a bounded worst intraday
> excursion and accept the measured cost; it intentionally diverges from the
> close-based backtest, as the v3 caveat below always warned.
>
> **Weight presets** (documented in config.yaml; equal weights stay the default since
> preset tilts are fitted on the same history they're scored on): conservative
> +229.9% / DD 22.8% / WF worst −4.1%; aggressive +269.5% / DD 23.5% / WF worst −2.4%;
> balanced +216.7% / DD 22.5% / WF worst −6.2%.
>
> Every knob above is enforced end-to-end: engine + risk gate + backtest parity
> (`bot/backtest.py` grew matching `reentry_cooldown_bars` / `exit_ladder_frac`
> options), bounds and defaults in `strattice/worker/config_gen.py`, and unit tests in
> `bot/test_portfolio_features.py`. Reproduce any table row with
> `python -m research.portfolio_study --study <entries|vol|btc|cooldown|brake|consec|weights|ladder> [--venue usdt]`.

> **v6 addendum (mid-July 2026, `strategy-optimization-research`)** — a six-family
> research sweep (`research/run_backtests.py --only regime_1d,...,breakout55_1d`) of
> externally documented daily trend edges, each implemented as a candle-pure module and
> replayed through the same harness + India cost model, then plateau-swept and
> walk-forwarded (200-bar OOS folds) head-to-head against the incumbent sleeve on every
> contested asset. Families researched: Faber-style trend-regime timing (the 100/200-day
> rule), Kaufman KAMA adaptive trend, Ichimoku kumo breakout, Wilder ADX/DMI-confirmed
> trend, risk-adjusted (vol-scaled) momentum per the risk-managed-momentum literature,
> MACD fresh-cross continuation, and the turtle System-2 55-day Donchian.
>
> **Promotions (each beats its incumbent under the identical protocol):**
>
> | Sleeve | Engine | Net (INR/twin) | WF folds (INR/USDT) | Replaces |
> | ------ | ------ | -------------: | :-----------------: | -------- |
> | I-BNB_INR  | **macd_trend 12/26/9** | +264.9% / +188.8% | **4/4 + 4/4** | volexp (+143.6/+171.9, 3/4+4/4) |
> | I-DOGE_INR | **trend_regime 100d**  | +209.8% / +167.5% | 3/4 + 1/4     | squeeze (+138.9/+36.5, 3/4+2/4) |
> | I-XRP_INR  | **momentum 55d (turtle S2)** | +274.4% / +101.9% | 2/4 + 2/4 | ma_cross (+187.7/+109.8, 1/4+1/4) |
> | I-ADA_INR  | **ichimoku 9/26/52**   | +83.3% / +42.6%   | 2/4 + 1/4     | accel (+60.1/+1.7, 1/4+1/4) |
> | I-SOL_INR  | **macd_trend 12/26/9** | +47.8% / +14.8%   | 3/4 + 3/4     | (none — SOL was unheld) |
>
> - **macd@BNB** posted the best walk-forward record in this repo's history: 8/8 folds
>   positive across BOTH venues, OOS +224%/+129% vs the incumbent's +138%/+93%. Its
>   whole 12-combo plateau (fast/slow 8/21-12/26 × signal 7/9 × confirm 3/5) is
>   positive on both venues.
> - **regime@DOGE** (Faber rule with a 2% hysteresis band + rising-line check)
>   dominates squeeze on full history on both venues; its p∈{100,120}×band∈{1-3%}
>   plateau is 6/6 positive on the USDT twin. Caveat carried forward: only 1/4 USDT
>   folds positive (compounded USDT OOS still +24.8%). The 150-day variant is
>   REJECTED (negative on most twins) — the 100-day line is the tested edge, not
>   "any long MA".
> - **turtle55@XRP** doubles ma_cross's INR net with the better fold record; it is a
>   second Donchian expression (lookback 55 vs BTC's 20) — family overlap accepted
>   because ma_cross's 1/4+1/4 folds were the weakest of the incumbent lineup.
> - **ichimoku@ADA** beats accel on every measured metric; accel@ADA is retired
>   (disabled stub) — its USDT OOS was **-10.5%**, the closest thing to a
>   loss-maker in the v5 lineup. Ichimoku's tested parameter sets are 6/6 positive
>   on both venues on ADA.
> - **macd@SOL**: SOL had NO venue-robust engine across five prior studies; macd is
>   the first (3/4+3/4 folds, positive both venues). The macd family clone
>   (BNB + SOL) is accepted for that reason and documented as correlated timing.
> - **Kept after defending their asset:** tsmom@ETH (challenger sharpe_mom scored
>   +272.2%/+41.1% full-history but a narrower plateau and -31pts INR OOS; tsmom keeps
>   the sleeve on plateau depth 18/18 and its 17/21 record from the 250-bar study) and
>   breakout20@BTC (challengers ichimoku@BTC and regime@BTC each lose on the USDT fold
>   record).
> - **REJECTED families:** `kama_trend` (adaptive MA — INR-positive but pays 40-78% of
>   capital in fees; twins negative on 3/7) and `adx_trend` (DMI cross + ADX filter —
>   negative on 5/7 USDT twins). Both stay in the registry so the rejections reproduce.
>   `sharpe_mom` is VALIDATED as a platform template (risk-adjusted momentum, default
>   I-ETH_INR +272.2% / twin +41.1%, 3/4+3/4 folds) but holds no bot sleeve.
> - Equal-sleeve average across the seven engines: **~+171%** net of all friction
>   (v5 six-sleeve lineup: ~+141%). Seven sleeves dilute each to ~0.139 of equity;
>   at the ₹100 exchange min-notional keep total capital ≥ ~₹1000.

> **v5 addendum (mid-July 2026, `crypto-profit-strategies`)** — two aggressive
> spot engines added and studied against the same data
> (`research/run_backtests.py --only accel_1d,cap_1d_tp,cap_1d_ch,...`). The brief
> was "unhinged" high-return tactics; the hard constraints of this bot bound what
> that can mean. It is **spot-only, long-only, full-allocation, no leverage/margin/
> futures** — enforced by `bot/backtest.py:_selftest_static_invariants`, which fails
> the build on any leverage/margin/futures/fund-movement call — and market
> manipulation (wash trading, spoofing, pump coordination, trading on MNPI) is
> illegal and was not implemented. So "aggressive" here means the two most
> aggressive *legal* spot edges that fit the pure-strategy interface:
>
> - **acceleration momentum VALIDATED** (new module `acceleration`): buy an
>   *accelerating* momentum leg (recent return outruns the prior leg by `accel_mult`)
>   into fresh highs on expanding volume — a harder-firing cousin of tsmom/Donchian.
>   Wide parameter plateau: **27/27** combos (fast 8/10/14 × min_return 6/8/10% ×
>   accel_mult 1.3/1.5/2.0) positive on the INR-pair median, every combo +5/5 across
>   the venue-robust pairs (median +77% to +161%). Full-history net is venue-robust
>   (INR **and** USDT twin both positive) on BNB, BTC, XRP, DOGE, ADA. **PROMOTED as
>   the 6th live sleeve @ I-ADA_INR** (+60.1% / twin +1.7%, PF 1.33). ADA is the only
>   venue-robust asset the existing five engines don't already hold. The on-ADA
>   head-to-head bake-off is the honest justification and its caveat both:
>
>   | ADA contender | INR net | USDT twin | robust | WF (200-bar OOS) |
>   | ------------- | ------: | --------: | :----: | :--------------: |
>   | ma_cross      | +99.5%  | +23.3%    | yes    | **3/4**          |
>   | tsmom         | +80.4%  | +50.4%    | yes    | 1/4              |
>   | vol_exp       | +67.5%  | +5.1%     | yes    | 1/4              |
>   | **accel**     | +60.1%  | +1.7%     | yes    | 1/4              |
>   | breakout      | +48.7%  | -23.2%    | no     | 1/4              |
>   | supertrend    | +27.6%  | -34.1%    | no     | 2/4              |
>   | squeeze       | +27.1%  | -18.5%    | no     | 1/4              |
>
>   ma_cross and tsmom *outscore* accel on ADA — but both would CLONE an engine already
>   in the lineup (ma_cross @ XRP, tsmom @ ETH). **Acceleration is the strongest
>   NON-duplicate signal family for ADA**, which is why it takes the slot in a lineup
>   whose entire design is one diversified engine per market. Caveats carried forward,
>   not hidden: accel's rolling 200-bar OOS is only **1/4** folds on ADA (its
>   full-history net and the 27/27 parameter plateau are the strength; the short ~2.8y
>   daily history means few folds), and adding a 6th sleeve dilutes each sleeve from
>   ~0.194 to ~0.162 of equity. It is a momentum/breakout-family engine, so it also
>   overlaps the BTC/DOGE breakout sleeves in *signal* even though ADA is a fresh asset.
> - **capitulation reversal REJECTED** (new module `capitulation`): buy a confirmed
>   green bounce off a violent oversold crash (deliberately *not* regime-gated — the
>   whole point is to fire below the trend MA), with an anti-death-spiral `max_drop`
>   guard. It is a lottery: rare (1-6 trades per 1000 bars), big-tailed both ways, and
>   venue-robust on only **1/7** assets (SOL) under either a take-profit or a
>   chandelier exit. This re-confirms Result 1/2 below — mean reversion does not
>   survive India friction at any altitude, and buying capitulation lows is just its
>   most violent form. Kept in the registry so the rejection reproduces; disabled.
> - **intraday variants of both confirm the friction wall**: `accel` and `cap` at 1h/4h
>   pay 45-220% of capital in fees+TDS and lose on nearly every market — the same wall
>   that retired the entire 15m/1h lineup in Result 1. Documented, not enabled.
>
> Net: the lineup goes from five sleeves to **six** — acceleration @ I-ADA_INR joins the
> five daily trend engines, taking the one venue-robust asset they didn't already hold.
> The falling-knife play (capitulation) stays out: it loses exactly where the friction
> study predicts. (Acceleration's on-ADA walk-forward is thin at 1/4 folds — this is a
> diversification-into-a-new-signal-family bet backed by a wide parameter plateau, not a
> claim that it is the single best strategy for ADA; ma_cross/tsmom score higher there
> but would duplicate existing engines.)

> **v4 addendum (late July 2026)** — a second study pass over the same data
> (`research/run_backtests.py --only supertrend_1d,ensemble_1d,squeeze_1d`):
>
> - **squeeze_breakout 1d PROMOTED** off the bench as a 5th sleeve @ I-DOGE_INR
>   (+138.9% net, PF 2.85 | USDT twin +36.5%): **18/21** walk-forward folds
>   positive — the best fold record of either study. The original redundancy
>   objection (same trigger family as the Donchian breakout) doesn't apply on a
>   different asset sleeve.
> - **supertrend 1d VALIDATED** (new module): 7/7 INR pairs positive at
>   mult 3.0 / ATR 10 (median +27.6%), 5/7 USDT twins, positive median across the
>   entire mult 2.5-3.5 × ATR 7-14 plateau, 15/21 folds. Offered as a platform
>   template (default I-BTC_INR: +94.6% / twin +21.8%); no bot sleeve because its
>   venue-robust assets are already occupied by stronger engines.
> - **trend_ensemble REJECTED** (multi-lookback Donchian consensus, after
>   Zarattini/Pagani/Barbon 2025): every long-only variant fails venue
>   robustness (best: 6/7 INR but 4/7 USDT, ADA -47%). The published edge needs
>   long/short + vol-targeted sizing this spot bot can't express. Module kept
>   only so the rejection reproduces.
> - **hf_forecast default model upgraded** to `amazon/chronos-2` (top zero-shot
>   forecaster on fev-bench/GIFT-Eval, Apache-2.0), with automatic fallback to
>   `chronos-bolt-tiny`. Still experimental: no crypto edge is claimed or proven.

**TL;DR — every intraday configuration lost money after real India friction; daily
trend-following won on nearly every market. The bot moved from a 15m mean-reversion-heavy
lineup to four daily trend engines (tsmom @ ETH, Donchian breakout @ BTC, MA cross @ XRP,
volatility-expansion @ BNB).**

## Data

Fetched by CI (`.github/workflows/fetch-market-data.yml` → `scripts/fetch_history.py`)
into `research/data/`, because market APIs are unreachable from the dev sandbox:

| Slice                  | Source                              | Coverage                         |
| ---------------------- | ----------------------------------- | -------------------------------- |
| `I-*_INR` 1d (7 pairs) | CoinDCX public API (the real venue) | 2023-09 → 2026-07 (~1000 bars)   |
| `I-*_INR` 1h / 15m     | CoinDCX public API                  | latest 1000 bars (API depth cap) |
| `B-*_USDT` 1h          | Binance public archive              | 2023-07 → 2026-05 (~25,600 bars) |
| `B-*_USDT` 15m         | Binance public archive              | 2025-05 → 2026-05 (~38,000 bars) |
| `B-*_USDT` 1d          | CoinDCX public API                  | 2023-10 → 2026-07                |

Assets: BTC, ETH, XRP, SOL, DOGE, BNB, ADA (all 14 pairs confirmed listed with ₹100
min-notional via `markets_details.json.gz`).

## Method

- Every candidate replayed through `bot/backtest.py:run` — the same engine-equivalent
  exits (stop / take-profit / time-stop / chandelier) and the same cost model as live:
  0.2% fee + 18% GST per side, **1% TDS per sell**, 5 bps slippage per fill.
- Grid: the 8 configured/phase-3/phase-4 candidates at 15m, re-expressions at 1h and 4h
  (resampled), daily variants, and a new `tsmom` module — 22 candidates x 14 markets
  (`research/run_backtests.py`).
- Robustness: parameter-plateau sweeps + rolling walk-forward (250-day out-of-sample
  folds) on the survivors. Reproduce with:
  `python -m research.run_backtests` (grid) and `python -m bot.backtest --data research/data/I-ETH_INR_1d.csv.gz --module tsmom ...` (single runs).

## Result 1: friction kills every intraday configuration

Median net return across all 14 markets (deep windows), net of all costs:

| Candidate                             | Interval |         Median net | Markets positive | Avg fees, % of capital |
| ------------------------------------- | -------- | -----------------: | ---------------: | ---------------------: |
| tsmom                                 | 1d       |         **+76.6%** |            12/14 |                    ~18 |
| momentum (Donchian)                   | 1d       |         **+69.9%** |            11/14 |                    ~26 |
| ma_crossover                          | 1d       |         **+47.4%** |            10/14 |                    ~10 |
| rsi (incl. Connors RSI-2)             | 1d       |           0 trades |                — |                      — |
| ma_crossover / rsi / tsmom / momentum | 4h       |      -0.4% … -5.0% |            ≤5/14 |                  10-25 |
| all candidates                        | 1h       |     -5.6% … -50.4% |            ≤4/14 |                 30-125 |
| **the entire current 15m lineup**     | 15m      | **-3.5% … -54.2%** |            ~0/14 |                 20-100 |

The 1h/15m strategies didn't lose because the signals were wrong — they lost because
87-125% of starting capital went to fees+TDS over the window. A 1% TDS per sell plus
0.47% fees per round trip is a ~1.5-1.7% toll that small mean-reversion wins can never
outrun. This matches the public evidence: post-TDS, Indian spot churn migrated to
swing/position timeframes; short-horizon mean reversion (Connors RSI-2 et al.) has
decayed even without TDS.

## Result 2: daily trend-following is robust, not lucky

Parameter sweeps on the 7 real INR daily series (median net / pairs positive):

- **tsmom**: all 18 combos (lookback 20/30/40 x min_return 7/10/15% x chandelier 3.0/3.5)
  positive, median +69% to +138%. `chandelier_k=3.5` beat 3.0 across the board.
- **Donchian breakout**: all 9 combos (lookback 15/20/30 x regime 40/50/70) positive,
  median +87% to +160%.
- **MA cross**: all 4 combos positive; 8/25 best (7/7 pairs positive, median +100%).
- **Volatility expansion**: 78/81 combos (short/long ATR x expansion mult x lookback)
  positive on 7/7 INR pairs, median +34% to +184% — the widest plateau of the study.
- Mean reversion was re-tested at daily altitude too and STILL loses
  (bb_reversion 1d median -1.2%, fast_rsi 1d -6.8%, rsi/Connors 1d ~0 trades) —
  its retirement is an altitude-independent result, not a 15m artifact.
  squeeze_breakout 1d is positive (+89% median) but overlaps the Donchian breakout's
  trigger, so it stays benched rather than double-loading the same signal family.

Rolling 250-day out-of-sample folds across all 7 INR pairs:
tsmom **17/21 positive**, breakout **16/21**, ma_cross 11/21.

## Result 3: the final lineup (venue-robustness rule)

Markets were assigned where the strategy was profitable on **both** the INR pair and its
USDT twin — a guard against pair lottery (e.g. tsmom made +120% on I-BTC_INR but lost
-6% on B-BTC_USDT, so tsmom did not get BTC):

| Strategy            | Market    | Net (2023-09→2026-07) |   PF | Trades | Max DD | USDT twin |
| ------------------- | --------- | --------------------: | ---: | -----: | -----: | --------: |
| tsmom 30d/+10%      | I-ETH_INR |           **+207.6%** | 2.58 |      7 |    38% |    +18.3% |
| Donchian 20d        | I-BTC_INR |           **+108.7%** | 2.75 |      8 |    32% |     +9.2% |
| MA 8/25             | I-XRP_INR |           **+187.7%** | 2.25 |      6 |    48% |   +109.8% |
| Vol-expansion 5/20d | I-BNB_INR |           **+143.6%** | 2.75 |      6 |    36% |   +171.9% |

Equal-sleeve portfolio: **~+162%** over ~2.8 years, net of all friction, at 18-62%
market exposure (buy-and-hold median was +117% at 100% exposure with deeper drawdowns).
Walk-forward folds positive: tsmom 17/21, breakout 16/21, vol-expansion 13/21 (with the
largest cumulative fold P&L of the study), MA cross 11/21.
All exits are chandelier trails (peak - 3.5xATR14) + a 7% hard stop; take-profits are
deliberately off — capping trend winners destroys the edge that pays the TDS toll.

## Retired

All 15m/1h/4h configurations of every module, and mean reversion at EVERY altitude:
`rsi`, `fast_rsi`, `bb_reversion` and Connors RSI-2 lose (or never trade) on daily bars
too. `squeeze_breakout` is benched (positive at 1d but redundant with the Donchian
breakout). Modules remain in the registry because the platform references them; they
are disabled in `config.yaml` with the evidence inline.

## Caveats

- INR daily history is ~2.8y (one regime cycle-ish: chop 2024, bull 2024-25, chop-bull
  2025-26). The USDT twin checks and 3y 1h windows partially derisk this.
- Backtests are close-based and long-only-flat, and the live engine matches them
  exactly: it drops the in-progress bar and evaluates entries AND protective exits on
  CLOSED daily bars only (no repainting). The flip side: stops act at daily-close
  granularity, so a violent single-day move can close well past the 7% stop line —
  the reported max-drawdowns include exactly those events. Adding an intraday "crash
  brake" on the live ticker would be a behavior change vs. this backtest and must be
  re-validated before adoption.
- CoinDCX INR books are thin; 5 bps modelled slippage is optimistic for size. At ₹1000
  total it is fine; re-validate before scaling past ~₹1L per sleeve.
- Because signals fire on closed daily bars, live entries execute within one poll
  (~5 min) _after_ the daily close at the then-current market price; the modelled
  5 bps slippage absorbs small drift between the bar close and the fill.
