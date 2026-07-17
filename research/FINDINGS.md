# Strategy review: backtest findings (July 2026)

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
>   (INR **and** USDT twin both positive) on BNB, BTC, XRP, DOGE, ADA. **Not promoted
>   to a live sleeve**, for the same reason supertrend wasn't: its venue-robust assets
>   are already occupied by incumbents that beat it head-to-head and carry deeper
>   walk-forward records (BTC breakout 16/21 vs accel 3/4; DOGE squeeze 18/21 vs accel
>   3/4), and the one *free* venue-robust asset (ADA) fails walk-forward (1/4 rolling
>   200-bar OOS folds). Offered as a platform template (default e.g. `acceleration`
>   @ I-XRP_INR: +191% / twin +90%). Enable it only by swapping out a weaker sleeve on
>   deliberate evidence, never by doubling an occupied asset (no-dup rule).
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
> Net: the lineup is **unchanged**. The disciplined "unhinged" result is that the one
> new edge strong enough to matter (acceleration) has no robust home the five existing
> engines aren't already covering better, and the falling-knife play (capitulation)
> loses exactly where the friction study predicts.

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
