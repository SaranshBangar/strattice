# Strategy review: backtest findings (July 2026)

**TL;DR — every intraday configuration lost money after real India friction; daily
trend-following won on nearly every market. The bot moved from a 15m mean-reversion-heavy
lineup to three daily trend engines (tsmom @ ETH, Donchian breakout @ BTC, MA cross @ XRP).**

## Data

Fetched by CI (`.github/workflows/fetch-market-data.yml` → `scripts/fetch_history.py`)
into `research/data/`, because market APIs are unreachable from the dev sandbox:

| Slice | Source | Coverage |
|---|---|---|
| `I-*_INR` 1d (7 pairs) | CoinDCX public API (the real venue) | 2023-09 → 2026-07 (~1000 bars) |
| `I-*_INR` 1h / 15m | CoinDCX public API | latest 1000 bars (API depth cap) |
| `B-*_USDT` 1h | Binance public archive | 2023-07 → 2026-05 (~25,600 bars) |
| `B-*_USDT` 15m | Binance public archive | 2025-05 → 2026-05 (~38,000 bars) |
| `B-*_USDT` 1d | CoinDCX public API | 2023-10 → 2026-07 |

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

| Candidate | Interval | Median net | Markets positive | Avg fees, % of capital |
|---|---|---:|---:|---:|
| tsmom | 1d | **+76.6%** | 12/14 | ~18 |
| momentum (Donchian) | 1d | **+69.9%** | 11/14 | ~26 |
| ma_crossover | 1d | **+47.4%** | 10/14 | ~10 |
| rsi (incl. Connors RSI-2) | 1d | 0 trades | — | — |
| ma_crossover / rsi / tsmom / momentum | 4h | -0.4% … -5.0% | ≤5/14 | 10-25 |
| all candidates | 1h | -5.6% … -50.4% | ≤4/14 | 30-125 |
| **the entire current 15m lineup** | 15m | **-3.5% … -54.2%** | ~0/14 | 20-100 |

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

Rolling 250-day out-of-sample folds across all 7 INR pairs:
tsmom **17/21 positive**, breakout **16/21**, ma_cross 11/21.

## Result 3: the final lineup (venue-robustness rule)

Markets were assigned where the strategy was profitable on **both** the INR pair and its
USDT twin — a guard against pair lottery (e.g. tsmom made +120% on I-BTC_INR but lost
-6% on B-BTC_USDT, so tsmom did not get BTC):

| Strategy | Market | Net (2023-09→2026-07) | PF | Trades | Max DD | USDT twin |
|---|---|---:|---:|---:|---:|---:|
| tsmom 30d/+10% | I-ETH_INR | **+207.6%** | 2.58 | 7 | 38% | +18.3% |
| Donchian 20d | I-BTC_INR | **+108.7%** | 2.75 | 8 | 32% | +9.2% |
| MA 8/25 | I-XRP_INR | **+187.7%** | 2.25 | 6 | 48% | +109.8% |

Equal-sleeve portfolio: **~+168%** over ~2.8 years, net of all friction, at 18-62%
market exposure (buy-and-hold median was +117% at 100% exposure with deeper drawdowns).
All exits are chandelier trails (peak - 3.5xATR14) + a 7% hard stop; take-profits are
deliberately off — capping trend winners destroys the edge that pays the TDS toll.

## Retired

All 15m/1h/4h configurations of: `rsi`, `fast_rsi`, `bb_reversion`, `vol_expansion`,
`squeeze_breakout`, 15m `ma_crossover`/`momentum`, and Connors RSI-2 (its gates never
even align on daily bars — 0 trades). Modules remain in the registry because the
platform references them; they are disabled in `config.yaml` with the evidence inline.

## Caveats

- INR daily history is ~2.8y (one regime cycle-ish: chop 2024, bull 2024-25, chop-bull
  2025-26). The USDT twin checks and 3y 1h windows partially derisk this.
- Backtests are close-based and long-only-flat, matching the live engine; intrabar
  stop gaps are approximated by close-price checks (same as live behavior, which polls
  every 5 minutes — live stops will usually fire *earlier* than the daily-close model).
- CoinDCX INR books are thin; 5 bps modelled slippage is optimistic for size. At ₹1000
  total it is fine; re-validate before scaling past ~₹1L per sleeve.
- Volume confirmation on the developing daily bar is conservative early in the day
  (accumulated volume < 20d average), so breakout entries tend to fire late in the
  day — this biases live entries toward confirmed bars, consistent with the backtest.
