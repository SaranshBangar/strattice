# Strattice — Competitive Landscape & Edge

_Last reviewed: July 2026. Prices are the competitors' published monthly rates at review
time; re-check before quoting them anywhere user-facing._

## 1. Who we actually compete with

Two different shelves, and we sit between them:

**Global bot platforms** (connect-your-exchange, strategy automation):

| Platform     | Entry price          | Core pitch                                  | Weakness we exploit                                              |
| ------------ | -------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| 3Commas      | ~$15–$50/mo          | DCA/grid/signal bots, SmartTrade terminal   | Cost stacks up; INR/India is an afterthought; fee/tax-blind P&L   |
| Cryptohopper | ~$24–$108/mo         | AI strategy designer, marketplace, copy     | Marketplace strategies are opaque; results ignore Indian friction |
| Bitsgap      | ~$23–$149/mo         | Grid/DCA/COMBO bots, multi-exchange         | Grid-first; simulations don't model GST/TDS                       |
| Coinrule     | free–$749/mo         | No-code "if this then that" rule builder    | Rules don't ship with honest multi-window backtests               |
| WunderTrading| free–~$20/mo         | TradingView-webhook execution, copy trading | Assumes you already have a strategy; no risk engine of ours       |
| Pionex       | free (0.05% fee)     | 16 bots built into its own exchange         | Custodial — your funds sit on Pionex; not INR-native              |

**India-native platforms:**

| Platform | Core pitch                                        | Weakness we exploit                                        |
| -------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Mudrex   | Curated "Coin Sets" baskets, passive investing    | Custodial custody model; no strategy transparency or control |
| Pi42     | INR-settled crypto futures (tax angle)            | It's an exchange, not an automation layer                   |
| KoinBasket| Thematic baskets                                  | Same: passive baskets, not executable strategies            |

## 2. Strattice's edge (what we defend)

1. **Non-custodial, structurally.** Bots trade on the user's own CoinDCX account with
   their own API keys (withdrawals disabled, IP-allowlisted). Pionex/Mudrex hold funds;
   we can't. After every exchange collapse this is our loudest safety claim.
2. **India-honest numbers.** Every preview, backtest and DRY_RUN fill is net of the real
   friction stack: exchange fee both legs, 18% GST on fees, 1% TDS on sells (~1.5% per
   round trip). No global competitor models GST/TDS. The landing page shows the ₹147.20
   friction ledger on a ₹10,000 round trip — keep that; it's the single most
   trust-building screen we have.
3. **Tax is a feature.** FY-aware India VDA tax card and CSV export (30% + TDS regime).
   Competitors leave users to reconstruct this from trade dumps.
4. **Transparent strategies, not a marketplace.** Seven templates that survived a
   multi-year backtest study (see `../research/FINDINGS.md`), each with plain-English
   entries/exits and editable parameters, plus a rule builder whose preview re-simulates
   across four history windows while you design. Cryptohopper sells black boxes; we show
   the knife being made.
5. **Risk sits in the execution path.** Hard stop per position, ATR trail/take-profit,
   daily-loss halt, trade caps, kill switch — enforced in the executor before every
   order, not offered as optional settings. This is the difference between "bot
   platform" and "risk-managed engine" and we should keep saying it that way.
6. **DRY_RUN by default, free during early access.** The competitor funnels ask for a
   card before conviction; ours asks for nothing until the paper trades convince you.

## 3. Where we're honestly behind (gaps, ranked by user pull)

1. **Single exchange, single venue.** CoinDCX-only vs 15–30 exchanges elsewhere. Fine
   while we're India-first; revisit if churn interviews say otherwise.
2. **No grid/DCA bots.** The most-demanded retail bot types. Our study rejected
   short-horizon styles for daily trend, but a *risk-capped* DCA accumulator would fit
   the engine and the audience.
3. **No mobile app.** Mudrex/Pionex are app-first; we're a responsive web app. A PWA
   wrapper + Telegram alerts (already shipped) covers most of the gap cheaply.
4. **No copy/social layer.** Deliberate for now — copy trading imports other people's
   risk. Don't build it to check a box.
5. **Manual key setup.** OAuth-style exchange linking (where CoinDCX supports it) would
   cut the biggest onboarding cliff.

## 4. Positioning sentence

> The only non-custodial algo platform built for Indian crypto traders: transparent,
> backtested strategies on your own CoinDCX account, with every number shown net of
> exchange fees, GST and TDS — free to paper-trade until it earns your trust.
