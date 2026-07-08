// The guardrails the engine actually enforces, surfaced verbatim in the UI so users
// see the real numbers, not adjectives. MUST stay in sync with worker/config_gen.py
// (_BASE.risk / TEMPLATE_DEFAULTS) - these are disclosures of enforced behavior.

/** Typed confirmation required to arm live trading (see goLiveAction). */
export const GO_LIVE_PHRASE = "GO LIVE";

/** Trading halts for the rest of the day once realized losses reach this share of equity.
 *  Mirrors worker/config_gen.py _BASE.risk.daily_loss_frac. */
export const DAILY_LOSS_HALT_PCT = 10;

/** Candle interval the live engine trades on (worker/config_gen.py _BASE.engine). */
export const ENGINE_INTERVAL = "1d";

/** What stands between a signal and your balance - shown wherever the user is about
 *  to arm real money. Every line is enforced in code, none of it is marketing. */
export const GUARDRAILS: [string, string][] = [
  [
    "Hard stop-loss",
    "Every strategy carries a per-position stop (5–7%, sized for daily-bar noise), checked on every poll and overriding the strategy's own signal.",
  ],
  [
    "ATR trail / take-profit",
    "Winners are exit-managed: chandelier trail or a fixed target, per template.",
  ],
  [
    `Daily loss halt · −${DAILY_LOSS_HALT_PCT}%`,
    `If realized losses reach ${DAILY_LOSS_HALT_PCT}% of equity in a day, trading stops until the next day.`,
  ],
  [
    "Trade cap",
    "A hard maximum number of orders per day; the risk gate blocks anything above it.",
  ],
  [
    "Kill switch",
    "Turning the bot off stops new entries at the next poll; open positions are still managed to their exit.",
  ],
];
